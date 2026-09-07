// Meeting domain logic (B5, B5c, spec §3, §3.1, §3.2, §5.3, §5.7, issue #25)
// — this is where meeting-related database work lives, parallel to
// lib/db/client.ts and lib/db/conflict-dismissal.ts. API routes call into
// here; they do not touch prisma.meeting, prisma.response or
// prisma.participantMeetingContext directly.

import { MeetingStatus, ResponseStatus } from "@/lib/generated/prisma/client";
import { meetingFromRow } from "@/lib/types/meeting-from-row";
import { participantMeetingContextFromRow } from "@/lib/types/participant-meeting-context-from-row";

import { canonicalMeetingPair, meetingsConflict } from "./conflict-dismissal";
import { getPrisma } from "./client";

import type { Prisma } from "@/lib/generated/prisma/client";
import type { MeetingModel } from "@/lib/generated/prisma/models";
import type {
  InitiateMeetingInput,
  RespondToMeetingInput,
} from "@/lib/meetings/schema";
import type {
  Meeting,
  ParticipantMeetingContext,
  Response,
} from "@/lib/types/meeting";

/** spec §3.1's "Three Mandatory Caps": at most 3 open meetings per group. */
const OPEN_MEETING_CAP = 3;

/**
 * Every status except closed/cancelled counts as "open" — against the cap
 * here, and against the conflict query in lib/db/conflict-dismissal.ts,
 * which is why this is exported rather than kept private to this file.
 */
export const OPEN_MEETING_STATUSES: MeetingStatus[] = [
  MeetingStatus.weighing,
  MeetingStatus.awaiting,
  MeetingStatus.stuck,
];

/**
 * spec §3.1: 3 reject-and-rematch cycles per meeting, default. A
 * `doesnt_suit` response always spends one; a second-or-later amendment by
 * the same person spends one too (the first is free) — see
 * `respondToMeeting`.
 */
const CYCLE_CAP = 3;

/** Statuses a meeting can no longer be responded to in. */
const CLOSED_MEETING_STATUSES: MeetingStatus[] = [
  MeetingStatus.closed,
  MeetingStatus.cancelled,
];

export class OpenMeetingCapReachedError extends Error {
  constructor(groupId: string) {
    super(`Group ${groupId} already has ${OPEN_MEETING_CAP} open meetings.`);
    this.name = "OpenMeetingCapReachedError";
  }
}

/** No Response row for this (meeting, user) pair — not a participant. */
export class NotAMeetingParticipantError extends Error {
  constructor(meetingId: string) {
    super(`No response row for meeting ${meetingId} and this user.`);
    this.name = "NotAMeetingParticipantError";
  }
}

/** The meeting is closed or cancelled — nothing left to respond to. */
export class MeetingNotOpenError extends Error {
  constructor(meetingId: string) {
    super(`Meeting ${meetingId} is no longer open.`);
    this.name = "MeetingNotOpenError";
  }
}

/**
 * A `@db.Date` column stores midnight UTC for a bare date — mirrors
 * meetingFromRow's toLocalDate, which reads this back with the UTC getters
 * for the same reason (see lib/types/meeting-from-row.ts).
 */
function toPinnedDateColumn(date: string | undefined): Date | null {
  return date === undefined ? null : new Date(`${date}T00:00:00.000Z`);
}

/**
 * Opens a meeting for a group: any subset of date/time/venue/occasion, the
 * all-blank case included (spec §3, §5.3). A Response row is created for
 * every current group member up front, defaulting to pending — see
 * Response's own comment on why that isn't done lazily.
 *
 * `currentDatetime` is deliberately left unset here even when a full pinned
 * date+time is given: turning a local wall-clock pin into the UTC instant
 * that column expects needs the APP_TIME_ZONE conversion described in
 * lib/types/primitives.ts, which no B5 acceptance criterion exercises yet.
 * Whichever task first reads currentDatetime (the feed, most likely) is
 * where that conversion belongs, tested against its own cases.
 */
export async function initiateMeeting(
  groupId: string,
  initiatorId: string,
  input: InitiateMeetingInput
): Promise<Meeting> {
  const prisma = getPrisma();

  const row = await prisma.$transaction(async (tx) => {
    const openCount = await tx.meeting.count({
      where: { groupId, status: { in: OPEN_MEETING_STATUSES } },
    });
    if (openCount >= OPEN_MEETING_CAP) {
      throw new OpenMeetingCapReachedError(groupId);
    }

    const members = await tx.groupMember.findMany({
      where: { groupId },
      select: { userId: true },
    });

    return tx.meeting.create({
      data: {
        groupId,
        initiatorId,
        pinnedDate: toPinnedDateColumn(input.date),
        pinnedTime: input.time ?? null,
        pinnedVenue: input.venue ?? null,
        occasion: input.occasion ?? null,
        responses: {
          create: members.map((member) => ({ userId: member.userId })),
        },
      },
    });
  });

  return meetingFromRow(row);
}

/**
 * Cancels every one of `userId`'s other open meetings that conflicts with
 * the one they just approved (spec §5.7) — same transaction as the
 * approval itself, so a mid-write failure leaves neither half-updated.
 *
 * A cancelled meeting is not deleted: it returns to `weighing`, and this
 * user's Response on it is set to `cant_make_it` — they are the one whose
 * approval elsewhere took the evening, so they are the one who drops out,
 * exactly as if they had pressed "I can't make it" themselves. The agent
 * proposing a new time to the others is downstream of that status change,
 * not this function's job.
 *
 * `ConflictDismissal`ed pairs are left alone — the user already said these
 * two don't clash.
 */
async function cancelConflictingMeetings(
  tx: Prisma.TransactionClient,
  userId: string,
  approvedMeeting: MeetingModel
): Promise<MeetingModel[]> {
  if (approvedMeeting.currentDatetime === null) return [];
  const approvedDatetime = approvedMeeting.currentDatetime;

  const otherResponses = await tx.response.findMany({
    where: {
      userId,
      meetingId: { not: approvedMeeting.id },
      meeting: {
        status: { in: OPEN_MEETING_STATUSES },
        currentDatetime: { not: null },
      },
    },
    include: { meeting: true },
  });

  const dismissals = await tx.conflictDismissal.findMany({
    where: { userId },
    select: { meetingAId: true, meetingBId: true },
  });
  const dismissedPairs = new Set(
    dismissals.map(
      ({ meetingAId, meetingBId }) => `${meetingAId}:${meetingBId}`
    )
  );

  const cancelled: MeetingModel[] = [];

  for (const otherResponse of otherResponses) {
    const otherMeeting = otherResponse.meeting;
    // Guaranteed by the query's own `currentDatetime: { not: null }` filter.
    const otherDatetime = otherMeeting.currentDatetime;
    if (otherDatetime === null) continue;
    if (!meetingsConflict(approvedDatetime, otherDatetime)) continue;

    const [a, b] = canonicalMeetingPair(approvedMeeting.id, otherMeeting.id);
    if (dismissedPairs.has(`${a}:${b}`)) continue;

    await tx.response.update({
      where: { id: otherResponse.id },
      data: { status: ResponseStatus.cant_make_it, respondedAt: new Date() },
    });
    const cancelledMeeting = await tx.meeting.update({
      where: { id: otherMeeting.id },
      data: { status: MeetingStatus.weighing },
    });
    cancelled.push(cancelledMeeting);
  }

  return cancelled;
}

export type RespondToMeetingResult = {
  meeting: Meeting;
  /** Set for approve / cant_make_it / doesnt_suit, null for an amendment. */
  response: Response | null;
  /** Set for an amendment, null for the other three. */
  participantContext: ParticipantMeetingContext | null;
  /**
   * Other open meetings of this user's, in other groups, that were
   * cancelled back to `weighing` because this approval conflicted with
   * them (spec §5.7). Always empty unless `kind` was `approve`.
   */
  cancelledConflicts: Meeting[];
};

/**
 * Records one of the four things a participant can do to an open meeting
 * (spec §3.2):
 *
 * - `approve` — updates this user's Response row, and cancels any of their
 *   other open meetings that conflict with this one (spec §5.7,
 *   `cancelConflictingMeetings`). Does not spend a cycle.
 * - `cant_make_it` — updates this user's Response row. Does not spend a
 *   cycle.
 * - `doesnt_suit` — updates the Response row with the free-text reason and
 *   always spends a cycle: it rejects the *output*.
 * - `amendment` — appends a ParticipantMeetingContext row rather than
 *   touching Response at all, because it corrects the *input*, not the
 *   output (see that type's own comment). The first one for a given
 *   (meeting, user) is free; the second and every one after costs a cycle.
 *
 * Spending a cycle that pushes `cycleCount` to the cap flips the meeting to
 * `stuck` (spec §3.1) — "the best option is shown with an explanation and
 * the group decides manually." Actually re-running the match on a spent
 * cycle (the batching window, the agent call) is B11's job, not this one's.
 */
export async function respondToMeeting(
  meetingId: string,
  userId: string,
  input: RespondToMeetingInput
): Promise<RespondToMeetingResult> {
  const prisma = getPrisma();

  const result = await prisma.$transaction(async (tx) => {
    const existingResponse = await tx.response.findUnique({
      where: { meetingId_userId: { meetingId, userId } },
      include: { meeting: true },
    });
    if (!existingResponse) {
      throw new NotAMeetingParticipantError(meetingId);
    }
    if (CLOSED_MEETING_STATUSES.includes(existingResponse.meeting.status)) {
      throw new MeetingNotOpenError(meetingId);
    }

    let response: Response | null = null;
    let participantContext: ParticipantMeetingContext | null = null;
    let cycleSpent = false;
    let cancelledConflicts: MeetingModel[] = [];

    switch (input.kind) {
      case "approve":
        response = await tx.response.update({
          where: { id: existingResponse.id },
          data: {
            status: ResponseStatus.approved,
            reasonText: null,
            respondedAt: new Date(),
          },
        });
        cancelledConflicts = await cancelConflictingMeetings(
          tx,
          userId,
          existingResponse.meeting
        );
        break;

      case "cant_make_it":
        response = await tx.response.update({
          where: { id: existingResponse.id },
          data: {
            status: ResponseStatus.cant_make_it,
            reasonText: null,
            respondedAt: new Date(),
          },
        });
        break;

      case "doesnt_suit":
        response = await tx.response.update({
          where: { id: existingResponse.id },
          data: {
            status: ResponseStatus.doesnt_suit,
            reasonText: input.reasonText,
            respondedAt: new Date(),
          },
        });
        cycleSpent = true;
        break;

      case "amendment": {
        const priorAmendments = await tx.participantMeetingContext.count({
          where: { meetingId, userId },
        });
        const contextRow = await tx.participantMeetingContext.create({
          data: {
            meetingId,
            userId,
            originLat: input.origin?.lat ?? null,
            originLng: input.origin?.lng ?? null,
            originLabel: input.originLabel ?? null,
            mobilityWindows: input.mobilityWindows ?? [],
            note: input.note ?? null,
          },
        });
        participantContext = participantMeetingContextFromRow(contextRow);
        // The first amendment is free (spec §3.1); the second and beyond
        // each cost a cycle, same as this function's other branches.
        cycleSpent = priorAmendments > 0;
        break;
      }
    }

    let meetingRow = existingResponse.meeting;
    if (cycleSpent) {
      const cycleCount = meetingRow.cycleCount + 1;
      meetingRow = await tx.meeting.update({
        where: { id: meetingId },
        data: {
          cycleCount,
          status:
            cycleCount >= CYCLE_CAP ? MeetingStatus.stuck : meetingRow.status,
        },
      });
    }

    return { meetingRow, response, participantContext, cancelledConflicts };
  });

  return {
    meeting: meetingFromRow(result.meetingRow),
    response: result.response,
    participantContext: result.participantContext,
    cancelledConflicts: result.cancelledConflicts.map(meetingFromRow),
  };
}

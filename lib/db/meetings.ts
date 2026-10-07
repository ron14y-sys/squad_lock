// Meeting domain logic (B5, B5c, spec §3, §3.1, §3.2, §5.3, §5.7, issue #25)
// — this is where meeting-related database work lives, parallel to
// lib/db/client.ts and lib/db/conflict-dismissal.ts. API routes call into
// here; they do not touch prisma.meeting, prisma.response or
// prisma.participantMeetingContext directly.

import {
  ExtractionOutcome,
  MeetingStatus,
  Prisma,
  ResponseStatus,
} from "@/lib/generated/prisma/client";
import { meetingFromRow } from "@/lib/types/meeting-from-row";
import {
  mergeContexts,
  participantMeetingContextFromRow,
} from "@/lib/types/participant-meeting-context-from-row";

import { canonicalMeetingPair, meetingsConflict } from "./conflict-dismissal";
import { GROUP_SIZE_FLOOR, GroupTooSmallError } from "./groups";
import { getPrisma } from "./client";

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
import type { TonightCorrection } from "@/lib/types/profile";
import type { LatLng, TimeSlot } from "@/lib/types/primitives";

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
export const CYCLE_CAP = 3;

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

    // #174, spec §5.3: "Groups of 3–6." — the lower bound is enforced here,
    // at the one place a meeting is ever created, rather than trying to
    // keep a group from shrinking below it (nothing removes a member yet).
    if (members.length < GROUP_SIZE_FLOOR) {
      throw new GroupTooSmallError(groupId, members.length);
    }

    return tx.meeting.create({
      data: {
        groupId,
        initiatorId,
        pinnedDate: toPinnedDateColumn(input.date),
        // #168: the chosen part of day (morning/midday/evening) rides in the
        // same column an exact time used to — see meetingFromRow's toPinnedWhen.
        pinnedTime: input.part ?? null,
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

/**
 * spec §3's step 8 — "Confirmation: once everyone still in has approved,
 * the card closes." "Still in" excludes anyone who said `cant_make_it` —
 * the same definition A8's `assembleRun` uses for who is still attending
 * (`run-cycle.ts`).
 *
 * Nobody still in is not a confirmation: every `Response` row is created at
 * initiation for a current group member (`initiateMeeting`), so this only
 * happens if literally everyone later drops out, and there is nobody left
 * to confirm a time and place for. It reads as "not yet," never as
 * "vacuously yes."
 *
 * Pure, and reads only the one field it needs, so `respondToMeeting`'s
 * transaction can hand it the rows it already fetched without reshaping
 * them — and this is unit-tested without a database.
 */
export function allStillInHaveApproved(
  responses: readonly { status: ResponseStatus }[]
): boolean {
  const stillIn = responses.filter(
    (response) => response.status !== ResponseStatus.cant_make_it
  );
  if (stillIn.length === 0) return false;
  return stillIn.every(
    (response) => response.status === ResponseStatus.approved
  );
}

/**
 * A new proposal asks everyone still in again (#176). A `Response` row
 * carries no link to the proposal it answered, so an approval left standing
 * would count towards a place and time the person was never shown — and
 * `allStillInHaveApproved` could close the meeting on it.
 *
 * `doesnt_suit` goes back to `pending` too: the new proposal is the answer
 * to that objection, and the sentence itself is kept on its own
 * `participant_meeting_contexts` row, which the timeline reads. Only
 * `cant_make_it` stays — it is leaving the meeting, not answering a proposal.
 *
 * Takes the caller's `tx`: A8's `weigh()` runs it in the same write that
 * puts the new proposal out, so there is no moment with a new proposal and
 * old approvals.
 */
export async function resetResponsesForNewProposal(
  tx: Prisma.TransactionClient,
  meetingId: string
): Promise<void> {
  await tx.response.updateMany({
    where: { meetingId, status: { not: ResponseStatus.cant_make_it } },
    data: {
      status: ResponseStatus.pending,
      reasonText: null,
      respondedAt: null,
      extractionOutcome: null,
    },
  });
}

/**
 * Which of B8's two status-change email triggers, if any, this response
 * just caused -- pure, same reason as `allStillInHaveApproved` above: it
 * only reads the two statuses `respondToMeeting`'s transaction already
 * has on hand (before its own updates, and after them), so it is
 * unit-tested without a database while the transition itself stays
 * DB-tested the way it already is.
 *
 * `closed` can never recur (`CLOSED_MEETING_STATUSES` blocks any further
 * response to a closed meeting), but `stuck` can -- a meeting can sit
 * `stuck` and still take another response (an amendment past the cap, for
 * instance), so `justStuck` needs the "wasn't already" half of the check
 * that `justClosed` technically doesn't. Both get it, for the same shape
 * and because "technically doesn't need it" is not the same as "must not
 * have it."
 */
export function transitionFlags(
  startingStatus: MeetingStatus,
  endingStatus: MeetingStatus
): { justClosed: boolean; justStuck: boolean } {
  return {
    justClosed:
      startingStatus !== MeetingStatus.closed &&
      endingStatus === MeetingStatus.closed,
    justStuck:
      startingStatus !== MeetingStatus.stuck &&
      endingStatus === MeetingStatus.stuck,
  };
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
  /**
   * True only on the response whose branch actually moved this meeting
   * onto `closed` just now (B8, spec §5.5 trigger #3) -- never on a
   * re-check of a meeting that was already closed, though that case can't
   * reach here anyway: `closed` is in `CLOSED_MEETING_STATUSES`, so a
   * further response to a closed meeting throws `MeetingNotOpenError`
   * before this is ever computed.
   */
  justClosed: boolean;
  /**
   * True only on the response whose branch actually moved this meeting
   * onto `stuck` just now (B8, spec §5.5 trigger #5). Unlike `closed`,
   * `stuck` is **not** in `CLOSED_MEETING_STATUSES` -- a further response
   * to an already-stuck meeting is allowed (an amendment past the cap,
   * for instance), and without this flag the caller has no way to tell
   * "just became stuck" from "was already stuck."
   */
  justStuck: boolean;
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
 *   puts the meeting back into `weighing`, which is what the next feed poll
 *   picks up to start a new run. It **spends no cycle here**: a cycle is a
 *   **rematch**, not a complaint ([#125](https://github.com/ron14y-sys/squad_lock/issues/125)),
 *   and the run that answers it is what counts one. Three people rejecting
 *   the same proposal within a minute used to reach the cap having produced
 *   one corrected proposal or none.
 *
 *   Spec §3.1 caps "**reject-and-rematch** cycles" at three, and the opening
 *   proposal is not one — nobody had rejected anything yet. So a meeting gets
 *   four proposals in all, and all three rejections are answered.
 *
 *   `approve` and `cant_make_it` also each check, after their own update,
 *   whether the meeting has just been confirmed — spec §3's step 8,
 *   `allStillInHaveApproved`. Either can be the response that completes
 *   "everyone still in": approving can finish the set, and so can dropping
 *   out, if the person who just said `cant_make_it` was the only one left
 *   who hadn't approved. The check only runs while the meeting is
 *   `awaiting`, the one status meaning a live proposal is actually out.
 * - `amendment` — appends a ParticipantMeetingContext row rather than
 *   touching Response at all, because it corrects the *input*, not the
 *   output (see that type's own comment). The first one for a given
 *   (meeting, user) is free; the second and every one after costs a cycle.
 *   B11: now also sets `backToWeighing`, same as `doesnt_suit` — an
 *   amendment is answered by a run too, just a batched one (spec §3.2).
 *
 * The cap is reached from two directions, and `stuck` means the same thing
 * in both (spec §3.1 — "the best option is shown with an explanation and the
 * group decides manually"): a rejection arriving when three proposals have
 * already been made has nowhere to go, and an amendment past the free one
 * still spends a cycle directly.
 *
 * B11: `cycleCount`'s two meanings (proposals made, amendment penalties)
 * turned out not to conflict. A non-free amendment's immediate `+ 1` here
 * is only ever a provisional read, for the cap check below and for
 * `stuck` — the run this amendment eventually earns overwrites it with
 * the authoritative `cycleNumber - 1` (`run-cycle.ts`'s success path) once
 * it actually happens, exactly the way a rejection's answer always has.
 * Nothing here needed to change for that to be true.
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

    // Captured before any of this call's own updates, so `justClosed` /
    // `justStuck` below can tell "became so just now" from "already was" --
    // see their own comments on `RespondToMeetingResult`.
    const startingStatus = existingResponse.meeting.status;

    let response: Response | null = null;
    let participantContext: ParticipantMeetingContext | null = null;
    let cycleSpent = false;
    let backToWeighing = false;
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
        backToWeighing = true;
        break;

      case "amendment": {
        // Only amendment rows count against the one free amendment (spec
        // §3.1). A7 and A8 append rejection rows to this same table, and
        // counting those would silently charge a cycle for somebody's *first*
        // real amendment — a rejection they made would come out of an
        // allowance that was never about rejections.
        //
        // Both clauses are load-bearing. `softPreferences IS NULL` alone was
        // enough while only a `soft` rejection wrote a row; now that every
        // rejection writes one, a "too far" or "not that place" row is also
        // NULL there and would be miscounted as an amendment.
        const priorAmendments = await tx.participantMeetingContext.count({
          where: {
            meetingId,
            userId,
            softPreferences: { equals: Prisma.DbNull },
            rejectionText: null,
          },
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
            toleranceKm: input.toleranceKm ?? null,
            earliestStart: input.earliestStart ?? null,
            latestStart: input.latestStart ?? null,
          },
        });
        participantContext = participantMeetingContextFromRow(contextRow);
        // The first amendment is free (spec §3.1); the second and beyond
        // each cost a cycle, same as this function's other branches.
        cycleSpent = priorAmendments > 0;
        // B11: an amendment is answered by a run too — spec §3.2's "triggers
        // a re-weighing after the batching window" — just a batched one
        // rather than an immediate one. Reusing `backToWeighing` below
        // means the same cap-vs-`stuck` decision `doesnt_suit` already
        // makes (reading `cycleCount` fresh, after this case's own write
        // above if it spent one) applies here with no new branch.
        backToWeighing = true;
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
    if (backToWeighing) {
      meetingRow = await tx.meeting.update({
        where: { id: meetingId },
        data: {
          // `weighing` is what the feed renders as "re-weighing"
          // (`meeting-cards.ts`), and what the poll looks for when it decides
          // whether a run is due. Until now a rejection left the meeting on
          // `awaiting`, so the feed said "waiting on others" while the system
          // was in fact about to weigh again — and nothing looked for it.
          // B11: an amendment reaches this same branch now too.
          //
          // No `+ 1` here: this rejection or amendment is answered by a run,
          // and the run counts itself. The cap is read, not written.
          //
          // `cycleCount` is rematches, so the comparison is exact: after the
          // opening proposal it is 0 and three rejections still fit.
          status:
            meetingRow.cycleCount >= CYCLE_CAP
              ? MeetingStatus.stuck
              : MeetingStatus.weighing,
        },
      });
    }

    // spec §3 step 8 — confirmation. `awaiting` is the only status meaning
    // a live proposal is actually out: `weighing` has nothing to confirm
    // yet, and a rejection or the cycle cap already moved the status away
    // in their own branches above — which is why this reads
    // `meetingRow.status` fresh rather than assuming anything about the
    // row this transaction started with.
    if (
      (input.kind === "approve" || input.kind === "cant_make_it") &&
      meetingRow.status === MeetingStatus.awaiting
    ) {
      const allResponses = await tx.response.findMany({
        where: { meetingId },
        select: { status: true },
      });
      if (allStillInHaveApproved(allResponses)) {
        meetingRow = await tx.meeting.update({
          where: { id: meetingId },
          data: { status: MeetingStatus.closed },
        });
      }
    }

    return {
      meetingRow,
      response,
      participantContext,
      cancelledConflicts,
      ...transitionFlags(startingStatus, meetingRow.status),
    };
  });

  return {
    meeting: meetingFromRow(result.meetingRow),
    response: result.response,
    participantContext: result.participantContext,
    cancelledConflicts: result.cancelledConflicts.map(meetingFromRow),
    justClosed: result.justClosed,
    justStuck: result.justStuck,
  };
}

/* -------------------------------------------------------------------------
 * A7 — the rejection loop's two touches on this table
 * ---------------------------------------------------------------------- */

/** What the group was last offered, as the Constraint Updater needs to see it. */
export type RejectedOption = {
  venueName: string;
  slot: TimeSlot;
  /** Where it was — what "too far" is measured against (#220). */
  location: LatLng | null;
};

/**
 * The rank-1 option of this meeting's latest run — the thing a rejection is
 * about (A7).
 *
 * `null` when no run has happened yet, which is every meeting today: nothing
 * creates a `MatchRun` until B11 wires the agent up. A rejection with nothing
 * proposed is not something to extract from.
 *
 * **The venue's neighbourhood and its soft facts are not here, because they
 * are not stored.** `MatchOption` snapshots the name, address and coordinates
 * only, and `VenueSoftFacts` has no column anywhere — B7 is what produces
 * them. The updater's payload leaves both absent rather than inventing them,
 * which is the same rule A4 follows for a venue it knows nothing about.
 */
export async function findRejectedOption(
  meetingId: string
): Promise<RejectedOption | null> {
  const prisma = getPrisma();

  const run = await prisma.matchRun.findFirst({
    where: { meetingId },
    orderBy: { cycleNumber: "desc" },
    include: { options: { where: { rank: 1 } } },
  });

  const option = run?.options[0];
  if (!option) return null;

  return {
    venueName: option.venueName,
    slot: { start: option.proposedDatetime, end: option.proposedEnd },
    location:
      option.venueLat !== null && option.venueLng !== null
        ? { lat: option.venueLat, lng: option.venueLng }
        : null,
  };
}

/**
 * Where this person is starting from tonight and how far they will go, as
 * the next weighing would see it (#220) — tonight's context over the
 * profile, the precedence `assembleRun` applies. What "too far" is measured
 * from, and the tolerance a "closer" tightens.
 */
export async function findTonightReach(
  meetingId: string,
  userId: string
): Promise<{ origin: LatLng | null; toleranceKm: number }> {
  const prisma = getPrisma();
  const [profileRow, contextRows] = await Promise.all([
    prisma.preferenceProfile.findUnique({ where: { userId } }),
    prisma.participantMeetingContext.findMany({
      where: { meetingId, userId },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const context = mergeContexts(
    contextRows.map(participantMeetingContextFromRow)
  );
  const home =
    profileRow?.homeLat != null && profileRow?.homeLng != null
      ? { lat: profileRow.homeLat, lng: profileRow.homeLng }
      : null;
  return {
    origin: context?.origin ?? home,
    toleranceKm: context?.toleranceKm ?? profileRow?.toleranceKm ?? 5,
  };
}

/** What a rejection set for this meeting besides the correction (#220). */
export type TonightBounds = {
  toleranceKm: number | null;
  earliestStart: string | null;
  latestStart: string | null;
  untranslated: string | null;
};

const NO_BOUNDS: TonightBounds = {
  toleranceKm: null,
  earliestStart: null,
  latestStart: null,
  untranslated: null,
};

/**
 * Records what A7 made of one rejection: the sentence, the correction when
 * there is one, and the outcome either way.
 *
 * One transaction, because a correction that lands without its outcome — or
 * an outcome recorded for a correction that was never written — would each be
 * a lie about what the next weighing is working from.
 *
 * **A row is appended for every rejection now, not only for a `soft` one**
 * (A8). It used to be written only when there was a correction to put in it,
 * which meant "no Asian food" — an objection this vocabulary cannot hold —
 * left no trace anywhere except `Response.reasonText`, and that column is
 * *updated*: the same person writing "no Italian either" overwrote it. Both
 * the next weighing and the timeline were left with one sentence per person,
 * forever. These rows append, so the history keeps itself.
 */
export async function recordRejectionOutcome(
  meetingId: string,
  userId: string,
  outcome: ExtractionOutcome,
  correction: TonightCorrection | null,
  reasonText: string,
  bounds: TonightBounds = NO_BOUNDS
): Promise<void> {
  const prisma = getPrisma();

  await prisma.$transaction(async (tx) => {
    await tx.participantMeetingContext.create({
      data: {
        meetingId,
        userId,
        ...bounds,
        softPreferences: correction ?? Prisma.DbNull,
        rejectionText: reasonText,
        rejectionOutcome: outcome,
      },
    });

    await tx.response.update({
      where: { meetingId_userId: { meetingId, userId } },
      data: { extractionOutcome: outcome },
    });
  });
}

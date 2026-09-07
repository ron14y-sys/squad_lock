// Meeting domain logic (B5, spec §3, §3.1, §5.3, issue #25) — this is where
// meeting-related database work lives, parallel to lib/db/client.ts and the
// not-yet-built lib/db/conflict-dismissal.ts (see that model's own comment
// in prisma/schema.prisma). API routes call into here; they do not touch
// prisma.meeting directly.

import { MeetingStatus } from "@/lib/generated/prisma/client";
import { meetingFromRow } from "@/lib/types/meeting-from-row";

import { getPrisma } from "./client";

import type { InitiateMeetingInput } from "@/lib/meetings/schema";
import type { Meeting } from "@/lib/types/meeting";

/** spec §3.1's "Three Mandatory Caps": at most 3 open meetings per group. */
const OPEN_MEETING_CAP = 3;

/** Every status except closed/cancelled counts as "open" against the cap. */
const OPEN_MEETING_STATUSES: MeetingStatus[] = [
  MeetingStatus.weighing,
  MeetingStatus.awaiting,
  MeetingStatus.stuck,
];

export class OpenMeetingCapReachedError extends Error {
  constructor(groupId: string) {
    super(`Group ${groupId} already has ${OPEN_MEETING_CAP} open meetings.`);
    this.name = "OpenMeetingCapReachedError";
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

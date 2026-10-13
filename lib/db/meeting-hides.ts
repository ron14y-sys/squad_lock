// Removing a finished meeting from your own lists (spec §5.6 history).
//
// Personal on purpose: the meeting belongs to everyone in it, so "remove" only
// records that *this* user no longer wants to see it. Nothing about the
// meeting changes, and nobody else's lists do.

import { MeetingStatus } from "@/lib/generated/prisma/client";

import { NotAMeetingParticipantError } from "./meetings";
import { getPrisma } from "./client";

/** The meeting is still going: hiding it would hide something that needs an answer. */
export class MeetingNotOverError extends Error {
  constructor(meetingId: string) {
    super(`Meeting ${meetingId} is not over yet.`);
    this.name = "MeetingNotOverError";
  }
}

/**
 * A meeting is over — and so may be hidden — once it is closed or cancelled,
 * or its date has passed. Mirrors what the feed calls a past meeting
 * (`isPast`), plus the two statuses that end one early.
 */
export function canHideMeeting(
  meeting: { status: MeetingStatus; currentDatetime: Date | null },
  now: number
): boolean {
  if (
    meeting.status === MeetingStatus.closed ||
    meeting.status === MeetingStatus.cancelled
  ) {
    return true;
  }
  return (
    meeting.currentDatetime !== null && meeting.currentDatetime.getTime() < now
  );
}

/**
 * Hides a finished meeting from this user's lists. Idempotent: hiding it
 * twice is hiding it once. A user who is not in the meeting gets the same
 * answer as for a meeting that does not exist.
 */
export async function hideMeeting(
  userId: string,
  meetingId: string
): Promise<void> {
  const prisma = getPrisma();

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: {
      status: true,
      currentDatetime: true,
      responses: { where: { userId }, select: { id: true } },
    },
  });
  if (!meeting || meeting.responses.length === 0) {
    throw new NotAMeetingParticipantError(meetingId);
  }
  if (!canHideMeeting(meeting, Date.now())) {
    throw new MeetingNotOverError(meetingId);
  }

  await prisma.meetingHide.upsert({
    where: { userId_meetingId: { userId, meetingId } },
    update: {},
    create: { userId, meetingId },
  });
}

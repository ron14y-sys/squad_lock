// What a group can do with a `stuck` meeting (C8b, spec §3.1, issue #45).
// Three rejections spend the cycle cap and the meeting stops searching — the
// spec hands the decision to the group. Nothing in the app could ever close or
// cancel a meeting, so a stuck one would sit in the group's three open slots
// for good; cancelling it is the way to free the slot and start over.

import { MeetingStatus } from "@/lib/generated/prisma/client";

import { NotAMeetingParticipantError } from "./meetings";
import { getPrisma } from "./client";

/** Only whoever started the meeting can cancel it for everyone. */
export class NotTheInitiatorError extends Error {
  constructor() {
    super("Only the initiator can cancel a meeting.");
    this.name = "NotTheInitiatorError";
  }
}

export class MeetingNotStuckError extends Error {
  constructor(meetingId: string) {
    super(`Meeting ${meetingId} is not stuck.`);
    this.name = "MeetingNotStuckError";
  }
}

/**
 * Cancels a stuck meeting. Restricted to the initiator because it closes the
 * meeting for every participant, and to `stuck` because cancelling a live
 * proposal is a different decision (the participants' own "I can't make it"
 * already covers leaving one).
 */
export async function cancelStuckMeeting(
  userId: string,
  meetingId: string
): Promise<void> {
  const prisma = getPrisma();

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { responses: { where: { userId }, select: { id: true } } },
  });
  if (!meeting || meeting.responses.length === 0) {
    throw new NotAMeetingParticipantError(meetingId);
  }
  if (meeting.initiatorId !== userId) throw new NotTheInitiatorError();
  if (meeting.status !== MeetingStatus.stuck) {
    throw new MeetingNotStuckError(meetingId);
  }

  await prisma.meeting.update({
    where: { id: meetingId },
    data: { status: MeetingStatus.cancelled },
  });
}

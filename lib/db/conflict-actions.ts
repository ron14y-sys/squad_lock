// The two ways out of a conflict warning (C8, spec §5.7, issue #44). B5b
// built the query that finds a clash and B5c built "approving cancels the
// other"; nothing wrote a `ConflictDismissal` and nothing let the user say
// "one of these needs to change" — those two writes are this file.

import { MeetingStatus } from "@/lib/generated/prisma/client";

import { canonicalMeetingPair } from "./conflict-dismissal";
import { MeetingNotOpenError, NotAMeetingParticipantError } from "./meetings";
import { getPrisma } from "./client";
import { rescheduleForConflict } from "@/lib/matching/reschedule";

/** A meeting cannot clash with itself. */
export class NotAConflictError extends Error {
  constructor() {
    super("A meeting cannot conflict with itself.");
    this.name = "NotAConflictError";
  }
}

/**
 * "These don't clash — keep both." Persisted per user and unordered pair, so
 * the warning does not return on the next poll or reload (spec §5.7).
 * Idempotent: saying it twice is the same as saying it once.
 */
export async function dismissConflict(
  userId: string,
  meetingId: string,
  otherMeetingId: string
): Promise<void> {
  if (meetingId === otherMeetingId) throw new NotAConflictError();

  const prisma = getPrisma();

  // Both meetings must be the caller's own — nobody dismisses a clash they
  // are not part of.
  const participations = await prisma.response.count({
    where: { userId, meetingId: { in: [meetingId, otherMeetingId] } },
  });
  if (participations !== 2) throw new NotAMeetingParticipantError(meetingId);

  const [meetingAId, meetingBId] = canonicalMeetingPair(
    meetingId,
    otherMeetingId
  );
  await prisma.conflictDismissal.upsert({
    where: { userId_meetingAId_meetingBId: { userId, meetingAId, meetingBId } },
    update: {},
    create: { userId, meetingAId, meetingBId },
  });
}

/**
 * "One of these needs to change" (spec §5.7). #251: the meeting moves at once
 * to another time — or day — at the venue it already has
 * (`rescheduleForConflict`); it is weighed in full only when that venue has
 * no other evening for the group. It used to be sent back to `weighing` and
 * left for B11, which never ran it: B11 only answers a rejection or an
 * amendment.
 *
 * When something somebody said is already waiting to be answered, that
 * weighing will avoid the clash by itself, so the meeting is only marked as
 * no longer holding its time: `currentDatetime` is cleared, which is what
 * lets the warning go away.
 *
 * Only a meeting still awaiting answers, or already weighing, can be sent
 * back — a `stuck` one has spent its cycles, and re-opening it here would be
 * a way round the cap.
 */
export async function sendMeetingBackToWeighing(
  userId: string,
  meetingId: string
): Promise<void> {
  const prisma = getPrisma();

  const response = await prisma.response.findUnique({
    where: { meetingId_userId: { meetingId, userId } },
    include: { meeting: true },
  });
  if (!response) throw new NotAMeetingParticipantError(meetingId);

  const { status } = response.meeting;
  if (status !== MeetingStatus.awaiting && status !== MeetingStatus.weighing) {
    throw new MeetingNotOpenError(meetingId);
  }

  const outcome = await rescheduleForConflict(meetingId);
  if (outcome === "skipped") {
    await prisma.meeting.update({
      where: { id: meetingId },
      data: { status: MeetingStatus.weighing, currentDatetime: null },
    });
  }
}

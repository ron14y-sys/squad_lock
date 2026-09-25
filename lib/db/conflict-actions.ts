// The two ways out of a conflict warning (C8, spec §5.7, issue #44). B5b
// built the query that finds a clash and B5c built "approving cancels the
// other"; nothing wrote a `ConflictDismissal` and nothing let the user say
// "one of these needs to change" — those two writes are this file.

import { MeetingStatus } from "@/lib/generated/prisma/client";

import { canonicalMeetingPair } from "./conflict-dismissal";
import { MeetingNotOpenError, NotAMeetingParticipantError } from "./meetings";
import { getPrisma } from "./client";

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
 * "One of these needs to change" — sends the chosen meeting back to
 * `weighing` (spec §5.7). Its current time is void, so `currentDatetime` is
 * cleared too: the conflict query only looks at meetings that have one, which
 * is what lets the warning go away instead of nagging about a proposal
 * that is already being replaced. The re-run itself is B11's job, exactly as
 * it is after B5c's cancellation.
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

  await prisma.meeting.update({
    where: { id: meetingId },
    data: { status: MeetingStatus.weighing, currentDatetime: null },
  });
}

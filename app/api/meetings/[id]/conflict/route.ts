// The two ways out of a conflict warning (C8, spec §5.7, issue #44):
// "these don't clash — keep both" (persisted as a ConflictDismissal) and
// "one of these needs to change" (sends the chosen meeting back to weighing).

import { auth } from "@/auth";
import {
  NotAConflictError,
  dismissConflict,
  sendMeetingBackToWeighing,
} from "@/lib/db/conflict-actions";
import {
  MeetingNotOpenError,
  NotAMeetingParticipantError,
} from "@/lib/db/meetings";
import { conflictActionSchema } from "@/lib/meetings/conflict-schema";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id: meetingId } = await params;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const parsed = conflictActionSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid conflict action.", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    if (parsed.data.kind === "keep_both") {
      await dismissConflict(userId, meetingId, parsed.data.otherMeetingId);
    } else {
      await sendMeetingBackToWeighing(userId, parsed.data.targetMeetingId);
    }
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof NotAMeetingParticipantError) {
      return Response.json({ error: "Meeting not found." }, { status: 404 });
    }
    if (error instanceof NotAConflictError) {
      return Response.json(
        { error: "A meeting cannot conflict with itself." },
        { status: 400 }
      );
    }
    if (error instanceof MeetingNotOpenError) {
      return Response.json(
        { error: "This meeting can no longer be sent back to weighing." },
        { status: 409 }
      );
    }
    throw error;
  }
}

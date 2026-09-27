// Cancelling a stuck meeting (C8b, spec §3.1, issue #45) — the initiator's way
// to settle it and free the group's open-meeting slot.

import { auth } from "@/auth";
import {
  MeetingNotStuckError,
  NotTheInitiatorError,
  cancelStuckMeeting,
} from "@/lib/db/stuck-actions";
import { NotAMeetingParticipantError } from "@/lib/db/meetings";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id: meetingId } = await params;

  try {
    await cancelStuckMeeting(userId, meetingId);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof NotAMeetingParticipantError) {
      return Response.json({ error: "Meeting not found." }, { status: 404 });
    }
    if (error instanceof NotTheInitiatorError) {
      return Response.json(
        { error: "Only the initiator can cancel a meeting." },
        { status: 403 }
      );
    }
    if (error instanceof MeetingNotStuckError) {
      return Response.json(
        { error: "Only a stuck meeting can be cancelled." },
        { status: 409 }
      );
    }
    throw error;
  }
}

// Removing a finished meeting from the caller's own lists. Personal: nobody
// else's view of the meeting changes.

import { auth } from "@/auth";
import { MeetingNotOverError, hideMeeting } from "@/lib/db/meeting-hides";
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
    await hideMeeting(userId, meetingId);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof NotAMeetingParticipantError) {
      return Response.json({ error: "Meeting not found." }, { status: 404 });
    }
    if (error instanceof MeetingNotOverError) {
      return Response.json(
        { error: "Only a finished meeting can be removed." },
        { status: 409 }
      );
    }
    throw error;
  }
}

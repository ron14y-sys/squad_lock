// Responding to a meeting (B5, spec §3.2, issue #25): approve, "I can't make
// it", "something doesn't work for me", or the amendment ("my situation
// tonight is different"). Only a participant — someone with a Response row
// for this meeting — can respond to it.

import {
  MeetingNotOpenError,
  NotAMeetingParticipantError,
  respondToMeeting,
} from "@/lib/db/meetings";
import { respondToMeetingSchema } from "@/lib/meetings/schema";
import { auth } from "@/auth";

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

  const parsed = respondToMeetingSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid response.", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const result = await respondToMeeting(meetingId, userId, parsed.data);
    return Response.json(result);
  } catch (error) {
    if (error instanceof NotAMeetingParticipantError) {
      return Response.json({ error: "Meeting not found." }, { status: 404 });
    }
    if (error instanceof MeetingNotOpenError) {
      return Response.json(
        { error: "This meeting is no longer open." },
        { status: 409 }
      );
    }
    throw error;
  }
}

// Leaving a group (#250). Any member can, except the last one, who can only
// delete it. See lib/db/group-membership.ts for what leaving does.

import { after } from "next/server";

import { auth } from "@/auth";
import {
  LastMemberError,
  NotInGroupError,
  leaveGroup,
} from "@/lib/db/group-membership";
import { notifyMeetingConfirmed } from "@/lib/email/notify";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id: groupId } = await params;

  try {
    const { closedMeetingIds } = await leaveGroup(userId, groupId);

    // Leaving can be what confirms a meeting: the one still to answer was the
    // person who left. The email goes out after the response, like the
    // respond route's does.
    after(async () => {
      await Promise.all(
        closedMeetingIds.map((meetingId) => notifyMeetingConfirmed(meetingId))
      );
    });

    return Response.json({ left: true });
  } catch (error) {
    // The same single answer the other group routes give: a group that does
    // not exist and one the caller is not in look alike from outside.
    if (error instanceof NotInGroupError) {
      return Response.json({ error: "Group not found." }, { status: 404 });
    }
    if (error instanceof LastMemberError) {
      return Response.json(
        { error: "You are the last member. Delete the group instead." },
        { status: 409 }
      );
    }
    throw error;
  }
}

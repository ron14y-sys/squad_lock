// The admin removing a member (#256). The same departure as leaving, asked
// for by the admin — see `leaveGroup` in lib/db/group-membership.ts.

import { after } from "next/server";

import { auth } from "@/auth";
import {
  NotInGroupError,
  NotTheAdminError,
  leaveGroup,
} from "@/lib/db/group-membership";
import { notifyMeetingConfirmed } from "@/lib/email/notify";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> }
): Promise<Response> {
  const session = await auth();
  const adminId = session?.user?.id;
  if (!adminId) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id: groupId, userId } = await params;
  if (userId === adminId) {
    return Response.json(
      { error: "Leave the group instead." },
      { status: 400 }
    );
  }

  try {
    const { closedMeetingIds } = await leaveGroup(userId, groupId, {
      removedBy: adminId,
    });

    // As when leaving: the one removed may have been the last to answer.
    after(async () => {
      await Promise.all(
        closedMeetingIds.map((meetingId) => notifyMeetingConfirmed(meetingId))
      );
    });

    return new Response(null, { status: 204 });
  } catch (error) {
    // A group, or a member, that is not there looks the same from outside.
    if (error instanceof NotInGroupError) {
      return Response.json({ error: "Group not found." }, { status: 404 });
    }
    if (error instanceof NotTheAdminError) {
      return Response.json(
        { error: "Only the admin can remove a member." },
        { status: 403 }
      );
    }
    throw error;
  }
}

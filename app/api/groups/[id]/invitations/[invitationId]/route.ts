// Cancelling a pending invitation — a mistyped address, or someone who is
// not coming after all. Any member can, the same as any member can invite.
//
// The row is deleted, not marked: nothing reads a cancelled invitation, and
// deleting it frees its place under the group's cap (`groupSizeWithPending`
// counts pending rows) and makes the emailed link answer "not found". Its
// notification log goes with it (`onDelete: Cascade`).

import { auth } from "@/auth";
import { getPrisma } from "@/lib/db/client";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; invitationId: string }> }
): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id: groupId, invitationId } = await params;

  const prisma = getPrisma();

  // Same single answer as inviting: a group that does not exist and one the
  // caller is not in look alike from outside.
  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
  });
  if (!membership) {
    return Response.json({ error: "Group not found." }, { status: 404 });
  }

  // `status: pending` in the delete itself, so an invitation accepted a
  // moment ago is not removed out from under a new member.
  const { count } = await prisma.invitation.deleteMany({
    where: { id: invitationId, groupId, status: "pending" },
  });
  if (count === 0) {
    const accepted = await prisma.invitation.findFirst({
      where: { id: invitationId, groupId },
      select: { id: true },
    });
    return accepted
      ? Response.json(
          { error: "This invitation has already been accepted." },
          { status: 409 }
        )
      : Response.json({ error: "Invitation not found." }, { status: 404 });
  }

  return new Response(null, { status: 204 });
}

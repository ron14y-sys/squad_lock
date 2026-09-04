// Accepting a group invitation (B4, spec §5.3, §12.1) — the only way
// anyone becomes a GroupMember. The token is the emailed link's whole
// identity; it works without the invitee already having a session that
// knows the group id, because when the email was sent they may not even
// have had a User row yet (B2's sign-in creates it on the way through
// here, same as any other route behind `auth()`).

import { auth } from "@/auth";
import { getPrisma } from "@/lib/db/client";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  const userEmail = session?.user?.email;
  if (!userId || !userEmail) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  const { token } = await params;

  const prisma = getPrisma();
  const invitation = await prisma.invitation.findUnique({ where: { token } });
  if (!invitation) {
    return Response.json({ error: "Invitation not found." }, { status: 404 });
  }

  if (invitation.status === "accepted") {
    // Accepting twice is only ever the same person retrying (a double
    // click, a refreshed page) or a stale link — not a new fact about
    // membership either way.
    if (invitation.acceptedByUserId === userId) {
      return Response.json(invitation);
    }
    return Response.json(
      { error: "This invitation has already been accepted." },
      { status: 409 }
    );
  }

  // The token is the link's whole identity, but the invitation was still
  // addressed to a specific person — accepting it under a different email
  // than the one it was sent to would let a forwarded link enroll someone
  // the inviter never chose (lib/groups/schema.ts normalises the same way
  // on the way in, so this compares like with like).
  if (invitation.email !== userEmail.trim().toLowerCase()) {
    return Response.json(
      { error: "This invitation was sent to a different address." },
      { status: 403 }
    );
  }

  const [, membership] = await prisma.$transaction([
    prisma.invitation.update({
      where: { id: invitation.id },
      data: {
        status: "accepted",
        acceptedByUserId: userId,
        respondedAt: new Date(),
      },
    }),
    prisma.groupMember.upsert({
      where: {
        groupId_userId: { groupId: invitation.groupId, userId },
      },
      update: {},
      create: { groupId: invitation.groupId, userId },
    }),
  ]);

  return Response.json({ groupId: membership.groupId });
}

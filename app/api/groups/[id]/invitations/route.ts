// Inviting someone to a group, by email (B4, spec §5.3, §12.1). Only a
// current member of the group can invite.
//
// B8 part two: the invitation email fires from here, via `after()`, and
// only on the row-creation path below — the "already invited, same row
// returned" path a few lines down is deliberately not a resend (spec §5.5
// names five triggers, not "every time someone clicks invite again"), and
// neither is the P2002 race-recovery path in the catch block, for the same
// reason: whichever concurrent request actually created the row is the one
// that already sent it.

import { auth } from "@/auth";
import { getPrisma } from "@/lib/db/client";
import { inviteToGroupSchema } from "@/lib/groups/schema";
import { Prisma } from "@/lib/generated/prisma/client";
import { notifyInvitation } from "@/lib/email/notify";
import { after } from "next/server";

/**
 * Listing a group's invitations, for the "pending and accepted members"
 * view (C4, spec §5.3). Deliberately omits `token`: that value is the
 * invited person's own unguessable link, not something every other member
 * of the group should be able to read off a roster.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id: groupId } = await params;

  const prisma = getPrisma();

  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
  });
  if (!membership) {
    return Response.json({ error: "Group not found." }, { status: 404 });
  }

  const invitations = await prisma.invitation.findMany({
    where: { groupId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      status: true,
      createdAt: true,
    },
  });

  return Response.json(invitations);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id: groupId } = await params;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const parsed = inviteToGroupSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid invitation.", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const prisma = getPrisma();

  // Deliberately one query, deliberately one error message either way: a
  // group that does not exist and a group the caller is not in are
  // indistinguishable from the outside, so there is nothing this app-for-
  // friends gains by telling a non-member which one it is.
  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
  });
  if (!membership) {
    return Response.json({ error: "Group not found." }, { status: 404 });
  }

  const { email } = parsed.data;

  const existing = await prisma.invitation.findUnique({
    where: { groupId_email: { groupId, email } },
  });

  if (existing?.status === "accepted") {
    return Response.json(
      { error: "This person is already a member." },
      { status: 409 }
    );
  }

  // Re-inviting an address with a still-pending invitation is a no-op that
  // returns the same row (same token) rather than a duplicate — see the
  // @@unique on Invitation in prisma/schema.prisma.
  if (existing) {
    return Response.json(existing);
  }

  try {
    const invitation = await prisma.invitation.create({
      data: { groupId, email, invitedById: userId },
    });
    after(() => notifyInvitation(invitation.id));
    return Response.json(invitation, { status: 201 });
  } catch (error) {
    // A concurrent request for the same (group, email) lost the race to
    // create — the row that won is the answer, not an error.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const invitation = await prisma.invitation.findUnique({
        where: { groupId_email: { groupId, email } },
      });
      if (invitation) return Response.json(invitation);
    }
    throw error;
  }
}

// Initiating a meeting (B5, spec §3, §3.1, §5.3, issue #25). Only a current
// member of the group can initiate; every field is independently optional —
// the all-blank case is the default path, not a degraded one, so an absent
// body is treated the same as `{}`, not as malformed input.

import { auth } from "@/auth";
import { getPrisma } from "@/lib/db/client";
import { initiateMeeting, OpenMeetingCapReachedError } from "@/lib/db/meetings";
import { initiateMeetingSchema } from "@/lib/meetings/schema";

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

  // An empty body is the all-blank case, not malformed input — only reject
  // text that claims to be JSON and isn't.
  let rawBody: unknown = {};
  const text = await request.text();
  if (text.length > 0) {
    try {
      rawBody = JSON.parse(text);
    } catch {
      return Response.json({ error: "Body must be JSON." }, { status: 400 });
    }
  }

  const parsed = initiateMeetingSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid meeting.", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const prisma = getPrisma();

  // Same convention as the invitations route: a group that doesn't exist
  // and a group the caller isn't a member of return the same 404.
  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
  });
  if (!membership) {
    return Response.json({ error: "Group not found." }, { status: 404 });
  }

  try {
    const meeting = await initiateMeeting(groupId, userId, parsed.data);
    return Response.json(meeting, { status: 201 });
  } catch (error) {
    if (error instanceof OpenMeetingCapReachedError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}

// Initiating a meeting (B5, spec §3, §3.1, §5.3, issue #25). Only a current
// member of the group can initiate; every field is independently optional —
// the all-blank case is the default path, not a degraded one, so an absent
// body is treated the same as `{}`, not as malformed input.

import { after } from "next/server";

import { auth } from "@/auth";
import { getPrisma } from "@/lib/db/client";
import { runDueMeetings } from "@/lib/matching/run-cycle";
import { initiateMeeting, OpenMeetingCapReachedError } from "@/lib/db/meetings";
import { listMeetingCardsForGroup } from "@/lib/db/meeting-cards";
import { initiateMeetingSchema } from "@/lib/meetings/schema";

// The Hobby plan's ceiling, and the reason it is here: the matching run A8
// starts from this route's `after()` callback runs inside this route's budget,
// not the client's. F2 measured a run at 6-23s against A1's 290s deadline, and
// the platform default would cut it off after ten. The GET itself still
// answers in milliseconds — nothing waits for the run.
export const maxDuration = 300;

// The group feed (C5, spec §5.6, issue #40): every meeting in the group, as
// a card carrying the viewer's own status. B5 never added this — it only
// needed to write meetings, not list them — so this is the read side C5
// needs and nobody else has built yet.
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

  const feed = await listMeetingCardsForGroup(groupId, userId);

  // A8: this poll is the clock. C5 already asks every ~3 seconds while a
  // meeting on screen is re-weighing, so no cron and no background job is
  // needed — which is what spec §3.2 requires. `after` runs the callback once
  // the response has been sent, inside this route's maxDuration, so the poll
  // stays fast and the next one sees the result. `runDueMeetings` decides
  // whether anything is actually due, claims it, and never throws.
  after(() => runDueMeetings(groupId));

  return Response.json(feed);
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

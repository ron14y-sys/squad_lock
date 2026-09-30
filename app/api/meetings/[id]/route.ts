// One meeting in full (C6, spec §5.6, issue #42): the proposal, where it
// stands, and what happened so far. Nobody needed to read a single meeting
// back until now — B5's respond route only ever writes one.

import { after } from "next/server";

import { auth } from "@/auth";
import { getPrisma } from "@/lib/db/client";
import { getMeetingDetail } from "@/lib/db/meeting-detail";
import { runDueMeetings } from "@/lib/matching/run-cycle";

// Same budget, same reason as the group feed's route: the run started from
// `after()` below counts against this route's duration.
export const maxDuration = 300;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id: meetingId } = await params;
  const prisma = getPrisma();

  // Same convention as elsewhere: a meeting that doesn't exist and one the
  // caller isn't a participant in return the same 404.
  const membership = await prisma.response.findUnique({
    where: { meetingId_userId: { meetingId, userId } },
  });
  if (!membership) {
    return Response.json({ error: "Meeting not found." }, { status: 404 });
  }

  const detail = await getMeetingDetail(meetingId, userId);
  if (!detail) {
    return Response.json({ error: "Meeting not found." }, { status: 404 });
  }

  // A8's clock, second hand. The person who rejected is usually still on
  // this page, and while only the feed ran due meetings a re-weighing waited
  // for somebody to open the group — half an hour in the first real test.
  // `runDueMeetings` claims before it runs, so this and the feed polling at
  // once still weigh a cycle only once.
  after(() => runDueMeetings(detail.groupId));

  return Response.json(detail);
}

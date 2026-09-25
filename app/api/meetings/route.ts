// Every open meeting the signed-in user is part of, across every group (C8,
// spec §5.6 "All groups", issue #44) — the source for the per-group "what
// awaits you" counts and the single cross-group timeline.

import { auth } from "@/auth";
import { listOpenMeetingCardsForUser } from "@/lib/db/meeting-cards";

export async function GET(): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  return Response.json(await listOpenMeetingCardsForUser(userId));
}

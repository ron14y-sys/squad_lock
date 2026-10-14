// C9 (#46): this user's notifications. Reading them marks nothing — each one
// is read once it is opened from the list (#238, `app/notifications/actions.ts`).

import { auth } from "@/auth";
import { listNotifications } from "@/lib/db/notifications";

export async function GET(): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  return Response.json(await listNotifications(userId));
}

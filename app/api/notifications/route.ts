// C9 (#46): this user's notifications. GET both reads and marks everything
// read, in that order — listNotifications runs first so the response still
// reflects which ones were new, and markAllNotificationsRead runs after so
// the badge count is back to zero by the next page load.

import { auth } from "@/auth";
import {
  listNotifications,
  markAllNotificationsRead,
} from "@/lib/db/notifications";

export async function GET(): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  const notifications = await listNotifications(userId);
  await markAllNotificationsRead(userId);

  return Response.json(notifications);
}

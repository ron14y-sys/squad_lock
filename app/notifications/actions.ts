"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { markNotificationRead } from "@/lib/db/notifications";

/**
 * #238: a notification opened from the list is read, and only that one. The
 * header's count is drawn by the root layout, which moving between pages
 * never redraws — revalidating it here is what takes the count down by one.
 */
export async function openNotification(id: string): Promise<void> {
  const session = await auth();
  if (!session?.user) return;
  await markNotificationRead(session.user.id, id);
  revalidatePath("/", "layout");
}

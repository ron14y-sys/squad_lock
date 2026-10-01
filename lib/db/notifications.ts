// C9 — the in-app notification center (#46, spec §5.5: "v1 notifications
// are in-app + email"). `lib/email/notify.ts`'s `notify*` functions call
// `recordInAppNotification` below alongside their existing `sendAndLog` —
// one trigger, two channels, never one instead of the other.
//
// Deliberately not routed through `lib/types/meeting-from-row.ts`-style
// converter: this is a feed DTO, not a stored domain shape, the same
// reasoning `lib/db/meeting-cards.ts`'s own header comment gives for why
// `MeetingCardDTO` is its own type.

import { getPrisma } from "./client";

import type { PrismaClient } from "@/lib/generated/prisma/client";
import type { NotificationKind } from "@/lib/generated/prisma/enums";

type NotificationsClient = {
  notification: Pick<
    PrismaClient["notification"],
    "create" | "findMany" | "updateMany" | "count"
  >;
};

/** Narrower than `NotificationsClient` — `recordInAppNotification` only ever calls `.create`, same convention as `lib/db/notification-log.ts`'s own `NotificationLogClient`. */
type RecordNotificationClient = {
  notification: Pick<PrismaClient["notification"], "create">;
};

/** One card the notification screen shows. Dates are ISO strings, same convention as `MeetingCardDTO`. */
export type NotificationCardDTO = {
  id: string;
  kind: NotificationKind;
  meetingId: string | null;
  createdAt: string;
  /** Whether this one was still unread *before* `markAllNotificationsRead` last ran — see that function's own comment on why the read state a screen renders is not the one the next query would return. */
  isNew: boolean;
};

/**
 * Written alongside `sendAndLog` by every `notify*` function in
 * `lib/email/notify.ts` except `notifyInvitation` — an invitation's
 * recipient may have no `User` row yet (that function's own comment), and
 * there is nobody signed in yet to show this to.
 *
 * Never throws: a failed write here must not take down the email send it
 * rides alongside, same discipline as `sendAndLog` itself failing to log.
 */
export async function recordInAppNotification(
  input: { userId: string; kind: NotificationKind; meetingId?: string },
  client: RecordNotificationClient = getPrisma()
): Promise<void> {
  try {
    await client.notification.create({
      data: {
        userId: input.userId,
        kind: input.kind,
        meetingId: input.meetingId ?? null,
      },
    });
  } catch (error) {
    console.error(
      `[notifications] failed to record kind=${input.kind} for user=${input.userId}`,
      error
    );
  }
}

/** How many of this user's notifications are still unread — the header badge's count. */
export async function countUnreadNotifications(
  userId: string,
  client: NotificationsClient = getPrisma()
): Promise<number> {
  return client.notification.count({ where: { userId, readAt: null } });
}

const LIST_LIMIT = 50;

/**
 * This user's most recent notifications, newest first, capped at
 * `LIST_LIMIT`. `isNew` reflects `readAt` as it stood *at this read* — the
 * caller (the notifications page) marks everything read immediately after,
 * so the one render where something is new is the one that would otherwise
 * never be seen as new at all.
 */
export async function listNotifications(
  userId: string,
  client: NotificationsClient = getPrisma()
): Promise<NotificationCardDTO[]> {
  const rows = await client.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: LIST_LIMIT,
  });

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    meetingId: row.meetingId,
    createdAt: row.createdAt.toISOString(),
    isNew: row.readAt === null,
  }));
}

/**
 * Marks every one of this user's notifications read. Called once, right
 * after `listNotifications` for the same request — see that function's own
 * comment on why the two run in that order rather than one combined query.
 */
export async function markAllNotificationsRead(
  userId: string,
  now: Date = new Date(),
  client: NotificationsClient = getPrisma()
): Promise<void> {
  await client.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: now },
  });
}

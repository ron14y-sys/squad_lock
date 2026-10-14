"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ScreenState } from "@/app/_components/ScreenState";
import { notificationText } from "@/lib/format/hebrew-labels";
import { APP_TIME_ZONE } from "@/lib/types/primitives";
import type { NotificationKind } from "@/lib/generated/prisma/enums";
import { openNotification } from "./actions";

type NotificationCard = {
  id: string;
  kind: NotificationKind;
  meetingId: string | null;
  /** Only on the group kinds (#250). */
  group?: {
    id: string;
    name: string | null;
    actorName: string | null;
    meetingsCancelled: number | null;
    linkable: boolean;
  };
  createdAt: string;
  isNew: boolean;
};

type LoadState = "loading" | "ready" | "signed-out" | "error";

const WHEN_FMT = new Intl.DateTimeFormat("he-IL", {
  timeZone: APP_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * Where tapping a card goes. A meeting-scoped kind goes straight to it;
 * `calendar_reconnect` has no meeting, so it goes to the same re-auth link
 * `calendarReconnectEmail` sends (`lib/email/templates.ts`'s own comment on
 * why `/groups` is the callback target). `invitation` never actually
 * appears here (see `lib/db/notifications.ts`), so it has no link of its
 * own — null falls through to a card opened in place.
 */
function hrefFor(card: NotificationCard): string | null {
  // #250: a group notice goes to its group, but only while there is one the
  // person is in — a deleted group has nowhere to go.
  if (card.group)
    return card.group.linkable ? `/groups/${card.group.id}` : null;
  if (card.meetingId) return `/meetings/${card.meetingId}`;
  if (card.kind === "calendar_reconnect") {
    return `/api/calendar/connect?callbackUrl=${encodeURIComponent("/groups")}`;
  }
  return null;
}

/**
 * C9 (#46): this user's notifications, newest first, the unread ones bold.
 * #238: one is read once it is opened — marked first, so the header's count
 * is down by one before the page it leads to; one with nowhere to go is
 * opened in place, and fades.
 */
export function NotificationsList() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [notifications, setNotifications] = useState<NotificationCard[]>([]);
  const router = useRouter();

  async function open(card: NotificationCard, href: string | null) {
    if (card.isNew) await openNotification(card.id).catch(() => {});
    if (href) router.push(href);
    else
      setNotifications((prev) =>
        prev.map((n) => (n.id === card.id ? { ...n, isNew: false } : n))
      );
  }

  useEffect(() => {
    fetch("/api/notifications")
      .then(async (res) => {
        if (res.status === 401) {
          setLoadState("signed-out");
          return;
        }
        if (!res.ok) {
          throw new Error(`GET /api/notifications: ${res.status}`);
        }
        setNotifications(await res.json());
        setLoadState("ready");
      })
      .catch(() => setLoadState("error"));
  }, []);

  if (loadState === "loading") {
    return <ScreenState kind="loading">טוען התראות…</ScreenState>;
  }

  if (loadState === "signed-out") {
    return (
      <ScreenState kind="notice" signIn>
        התחבר כדי לראות את ההתראות שלך.
      </ScreenState>
    );
  }

  if (loadState === "error") {
    return <ScreenState kind="error">לא הצלחנו לטעון את ההתראות.</ScreenState>;
  }

  if (notifications.length === 0) {
    return <ScreenState kind="empty">אין לך התראות עדיין.</ScreenState>;
  }

  return (
    <div className="flex flex-col gap-2">
      {notifications.map((card) => {
        const href = hrefFor(card);
        const content = (
          <div className={`sl-panel ${card.isNew ? "" : "opacity-60"}`}>
            <p className="sl-line">{notificationText(card)}</p>
            <p className="sl-sub">
              {WHEN_FMT.format(new Date(card.createdAt))}
            </p>
          </div>
        );

        return href ? (
          <Link
            key={card.id}
            href={href}
            onClick={(e) => {
              e.preventDefault();
              open(card, href);
            }}
          >
            {content}
          </Link>
        ) : (
          <button
            key={card.id}
            type="button"
            className="text-start"
            onClick={() => open(card, null)}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}

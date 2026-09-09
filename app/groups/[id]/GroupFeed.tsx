"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { APP_TIME_ZONE } from "@/lib/types/primitives";

type ResponseStatus = "pending" | "approved" | "cant_make_it" | "doesnt_suit";

type MeetingCardStatus =
  | "waiting_on_you"
  | "waiting_on_others"
  | "reweighing"
  | "conflicting"
  | "stuck"
  | "closed";

type PinnedWhen =
  | { kind: "date"; date: string }
  | { kind: "date_and_time"; date: string; time: string };

type MeetingCard = {
  id: string;
  status: MeetingCardStatus;
  waitingOn: number | null;
  currentDatetime: string | null;
  pinnedWhen: PinnedWhen | null;
  pinnedVenue: string | null;
  occasion: string | null;
  createdAt: string;
  approvedCount: number;
  totalCount: number;
  isPast: boolean;
  participants: { userId: string; name: string; status: ResponseStatus }[];
};

type Feed = { meetings: MeetingCard[]; openCount: number };

type LoadState = "loading" | "ready" | "signed-out" | "not-found" | "error";

const OPEN_MEETING_CAP = 3;

const STATUS_LABEL: Record<MeetingCardStatus, string> = {
  waiting_on_you: "ממתין לך",
  waiting_on_others: "ממתין לאחרים",
  reweighing: "משוקלל מחדש",
  conflicting: "מתנגש עם פגישה אחרת",
  stuck: "תקוע",
  closed: "סגור",
};

const RESPONSE_LABEL: Record<ResponseStatus, string> = {
  pending: "טרם הגיב",
  approved: "אישר",
  cant_make_it: "לא יכול להגיע",
  doesnt_suit: "לא מתאים לו",
};

const DATE_FMT = new Intl.DateTimeFormat("he-IL", {
  timeZone: APP_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
});

const TIME_FMT = new Intl.DateTimeFormat("he-IL", {
  timeZone: APP_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** `"2026-09-15"` → `"15/09"`. Already local wall clock, so no zone conversion belongs here. */
function formatLocalDate(date: string): string {
  const [, month, day] = date.split("-");
  return `${day}/${month}`;
}

function dateBlockLabel(card: MeetingCard): string {
  if (card.currentDatetime)
    return DATE_FMT.format(new Date(card.currentDatetime));
  if (card.pinnedWhen) return formatLocalDate(card.pinnedWhen.date);
  return "טרם נקבע";
}

function statusLabel(card: MeetingCard): string {
  if (card.status === "waiting_on_others" && card.waitingOn !== null) {
    return `ממתין לעוד ${card.waitingOn}`;
  }
  return STATUS_LABEL[card.status];
}

function summaryLine(card: MeetingCard): string {
  if (card.occasion) return card.occasion;
  const time =
    card.currentDatetime &&
    ` בשעה ${TIME_FMT.format(new Date(card.currentDatetime))}`;
  const venue = card.pinnedVenue ? ` ב${card.pinnedVenue}` : "";
  return `${card.approvedCount} מתוך ${card.totalCount} אישרו${venue}${time ?? ""}`;
}

function avatarClasses(status: ResponseStatus): string {
  switch (status) {
    case "approved":
      return "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-black";
    case "pending":
      return "border border-zinc-400 text-zinc-500 dark:border-zinc-600";
    default:
      return "border border-dashed border-zinc-300 text-zinc-400 opacity-60 dark:border-zinc-700";
  }
}

function MeetingAvatars({
  participants,
}: {
  participants: MeetingCard["participants"];
}) {
  return (
    <div className="flex -space-x-2 rtl:space-x-reverse">
      {participants.map((p) => (
        <div
          key={p.userId}
          title={`${p.name} — ${RESPONSE_LABEL[p.status]}`}
          className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${avatarClasses(
            p.status
          )}`}
        >
          {p.name.charAt(0)}
        </div>
      ))}
    </div>
  );
}

function MeetingCardRow({ card }: { card: MeetingCard }) {
  const highlighted = card.status === "waiting_on_you";

  return (
    <div
      className={`flex items-center gap-3 rounded-md border px-3 py-2 ${
        highlighted
          ? "border-indigo-600 dark:border-indigo-400"
          : "border-zinc-300 dark:border-zinc-700"
      }`}
    >
      <div
        className={`flex h-10 w-12 shrink-0 flex-col items-center justify-center rounded text-xs font-semibold ${
          highlighted
            ? "bg-indigo-600 text-white"
            : "bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
        }`}
      >
        {dateBlockLabel(card)}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`text-xs font-medium ${
              highlighted
                ? "text-indigo-600 dark:text-indigo-400"
                : "text-zinc-500"
            }`}
          >
            {statusLabel(card)}
          </span>
        </div>
        <p className="truncate text-sm text-zinc-900 dark:text-zinc-50">
          {summaryLine(card)}
        </p>
      </div>

      <MeetingAvatars participants={card.participants} />
    </div>
  );
}

export function GroupFeed({ groupId }: { groupId: string }) {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [feed, setFeed] = useState<Feed | null>(null);
  // Read by the polling effect without re-running it on every fetch.
  const feedRef = useRef<Feed | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    async function fetchFeed(): Promise<boolean> {
      try {
        const res = await fetch(`/api/groups/${groupId}/meetings`);
        if (cancelled) return false;
        if (res.status === 401) {
          setLoadState("signed-out");
          return false;
        }
        if (res.status === 404) {
          setLoadState("not-found");
          return false;
        }
        if (!res.ok) throw new Error(`GET meetings: ${res.status}`);

        const body = (await res.json()) as Feed;
        if (cancelled) return false;
        feedRef.current = body;
        setFeed(body);
        setLoadState("ready");
        return body.meetings.some((m) => m.status === "reweighing");
      } catch {
        if (!cancelled)
          setLoadState((prev) => (prev === "loading" ? "error" : prev));
        return false;
      }
    }

    function scheduleNext(hasReweighing: boolean) {
      // Backgrounded: polling stops entirely (spec §5.6), not just slows down.
      if (document.visibilityState !== "visible") return;
      timeoutId = setTimeout(poll, hasReweighing ? 3000 : 30000);
    }

    async function poll() {
      if (cancelled) return;
      const hasReweighing = await fetchFeed();
      if (!cancelled) scheduleNext(hasReweighing);
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        // Coming back to the foreground refreshes immediately rather than
        // waiting out whatever delay was already ticking.
        if (timeoutId) clearTimeout(timeoutId);
        poll();
        return;
      }
      // Going to the background cancels whatever poll was already queued —
      // "stop entirely" means no more requests, not one last one in flight.
      if (timeoutId) clearTimeout(timeoutId);
    }

    poll();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [groupId]);

  if (loadState === "loading") {
    return <p className="p-6 text-sm text-zinc-500">טוען פגישות…</p>;
  }
  if (loadState === "signed-out") {
    return <p className="p-6 text-sm text-zinc-500">התחבר כדי לראות פגישות.</p>;
  }
  if (loadState === "not-found") {
    return (
      <p className="p-6 text-sm text-zinc-500">
        הקבוצה הזו לא נמצאה, או שאתה לא חבר בה.
      </p>
    );
  }
  if (loadState === "error" || !feed) {
    return (
      <p className="p-6 text-sm text-red-600">
        לא הצלחנו לטעון את הפגישות. נסה לרענן את הדף.
      </p>
    );
  }

  const atCap = feed.openCount >= OPEN_MEETING_CAP;
  let dividerShown = false;

  return (
    <section className="flex flex-col gap-3 border-t border-zinc-300 p-6 pt-6 dark:border-zinc-700">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        פגישות ({feed.openCount} פתוחות)
      </h2>

      {feed.meetings.length === 0 && (
        <p className="text-sm text-zinc-500">אין עדיין פגישות בקבוצה הזו.</p>
      )}

      <div className="flex flex-col gap-2">
        {feed.meetings.map((card) => {
          const showDivider = card.isPast && !dividerShown;
          if (showDivider) dividerShown = true;
          return (
            <div key={card.id} className="flex flex-col gap-2">
              {showDivider && (
                <div className="border-t border-dashed border-zinc-300 pt-2 text-xs text-zinc-400 dark:border-zinc-700">
                  פגישות שעברו
                </div>
              )}
              <MeetingCardRow card={card} />
            </div>
          );
        })}
      </div>

      {atCap ? (
        <button
          type="button"
          disabled
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-black"
        >
          פתח פגישה חדשה
        </button>
      ) : (
        <Link
          href={`/groups/${groupId}/new`}
          className="rounded-md bg-zinc-900 px-4 py-2 text-center text-sm font-medium text-white dark:bg-zinc-50 dark:text-black"
        >
          פתח פגישה חדשה
        </Link>
      )}
      {atCap && (
        <p className="text-xs text-zinc-500">
          אי אפשר לפתוח פגישה נוספת — יש כבר {OPEN_MEETING_CAP} פגישות פתוחות
          בקבוצה. סגור או השלם אחת מהן כדי לפתוח חדשה.
        </p>
      )}
    </section>
  );
}

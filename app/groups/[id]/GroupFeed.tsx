"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { meetingDateLabel, meetingTimeLabel } from "@/lib/format/meeting-when";
import {
  RESPONSE_STATUS_LABELS,
  meetingStatusLabel,
} from "@/lib/format/hebrew-labels";
import { ConflictBanner } from "@/app/_components/ConflictBanner";
import {
  avatarClass,
  stickerClass,
  tiltClass,
} from "@/app/_components/meeting-style";

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

function summaryLine(card: MeetingCard): string {
  // A stuck meeting must say so in the feed rather than quietly sit there (spec §3.1).
  if (card.status === "stuck") return "לא מצאנו הצעה — צריך להחליט ידנית";
  if (card.occasion) return card.occasion;
  const time =
    card.currentDatetime && ` בשעה ${meetingTimeLabel(card.currentDatetime)}`;
  const venue = card.pinnedVenue ? ` ב${card.pinnedVenue}` : "";
  return `${card.approvedCount} מתוך ${card.totalCount} אישרו${venue}${time ?? ""}`;
}

function MeetingAvatars({
  participants,
}: {
  participants: MeetingCard["participants"];
}) {
  return (
    <div className="sl-av">
      {participants.map((p) => (
        <span
          key={p.userId}
          title={`${p.name} — ${RESPONSE_STATUS_LABELS[p.status]}`}
          className={avatarClass(p.status)}
        >
          {p.name.charAt(0)}
        </span>
      ))}
    </div>
  );
}

function MeetingCardRow({ card, index }: { card: MeetingCard; index: number }) {
  const isYou = card.status === "waiting_on_you";

  return (
    <Link
      href={`/meetings/${card.id}`}
      className={`sl-card ${isYou ? "is-you" : tiltClass(index)}`}
    >
      <div className="sl-date">{meetingDateLabel(card)}</div>

      <div className="sl-body">
        <span className={`sl-stk ${stickerClass(card.status)}`}>
          {meetingStatusLabel(card.status, card.waitingOn)}
        </span>
        <p className="sl-line truncate">{summaryLine(card)}</p>
      </div>

      <MeetingAvatars participants={card.participants} />
    </Link>
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
    return <p className="sl-page sl-sub">טוען פגישות…</p>;
  }
  if (loadState === "signed-out") {
    return <p className="sl-page sl-sub">התחבר כדי לראות פגישות.</p>;
  }
  if (loadState === "not-found") {
    return (
      <p className="sl-page sl-sub">הקבוצה הזו לא נמצאה, או שאתה לא חבר בה.</p>
    );
  }
  if (loadState === "error" || !feed) {
    return (
      <p className="sl-page sl-sub">
        לא הצלחנו לטעון את הפגישות. נסה לרענן את הדף.
      </p>
    );
  }

  const atCap = feed.openCount >= OPEN_MEETING_CAP;
  let dividerShown = false;

  return (
    <section className="sl-page">
      <h2 className="sl-sec">פגישות ({feed.openCount} פתוחות)</h2>

      {feed.meetings.length === 0 && (
        <p className="sl-sub">אין עדיין פגישות בקבוצה הזו.</p>
      )}

      {feed.meetings.some((m) => m.status === "conflicting") && (
        <ConflictBanner />
      )}

      <div className="flex flex-col gap-4">
        {feed.meetings.map((card, index) => {
          const showDivider = card.isPast && !dividerShown;
          if (showDivider) dividerShown = true;
          return (
            <div key={card.id} className="flex flex-col gap-3">
              {showDivider && <div className="sl-sec">פגישות שעברו</div>}
              <MeetingCardRow card={card} index={index} />
            </div>
          );
        })}
      </div>

      {atCap ? (
        <button type="button" disabled className="sl-btn">
          פתח פגישה חדשה
        </button>
      ) : (
        <Link href={`/groups/${groupId}/new`} className="sl-btn go">
          פתח פגישה חדשה
        </Link>
      )}
      {atCap && (
        <p className="sl-note">
          אי אפשר לפתוח פגישה נוספת — יש כבר {OPEN_MEETING_CAP} פגישות פתוחות
          בקבוצה. סגור או השלם אחת מהן כדי לפתוח חדשה.
        </p>
      )}
    </section>
  );
}

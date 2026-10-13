"use client";

import { useCallback, useEffect, useState } from "react";
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
import { ScreenState } from "@/app/_components/ScreenState";
import { cardsPollDelay, usePolling } from "@/app/_components/use-polling";

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
  | { kind: "date_and_time"; date: string; time: string }
  | { kind: "part_of_day"; part: "morning" | "midday" | "evening" }
  | {
      kind: "date_and_part_of_day";
      date: string;
      part: "morning" | "midday" | "evening";
    };

type MeetingCard = {
  id: string;
  status: MeetingCardStatus;
  waitingOn: number | null;
  firstSearch: boolean;
  runStage: string | null;
  currentDatetime: string | null;
  pinnedWhen: PinnedWhen | null;
  pinnedVenue: string | null;
  proposedVenue: string | null;
  occasion: string | null;
  createdAt: string;
  approvedCount: number;
  totalCount: number;
  isPast: boolean;
  canHide: boolean;
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
  // Where the proposal is, once there is one — not where it was asked to be
  // (#212): the two differ whenever the asked-for place could not be offered.
  const where = card.proposedVenue ?? card.pinnedVenue;
  const venue = where ? ` ב${where}` : "";
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
          {meetingStatusLabel(card.status, card.waitingOn, card.firstSearch)}
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

  // The first load, and every one `usePolling` asks for after it.
  const fetchFeed = useCallback(async () => {
    try {
      const res = await fetch(`/api/groups/${groupId}/meetings`);
      if (res.status === 401) return setLoadState("signed-out");
      if (res.status === 404) return setLoadState("not-found");
      if (!res.ok) throw new Error(`GET meetings: ${res.status}`);
      setFeed((await res.json()) as Feed);
      setLoadState("ready");
    } catch {
      setLoadState((prev) => (prev === "loading" ? "error" : prev));
    }
  }, [groupId]);

  useEffect(() => {
    fetchFeed();
  }, [fetchFeed]);
  usePolling(fetchFeed, feed && cardsPollDelay(feed.meetings));

  // Removing a finished meeting from my own list: personal, the meeting stays
  // for everyone else.
  const [hideFailed, setHideFailed] = useState(false);
  async function hideMeeting(meetingId: string) {
    setHideFailed(false);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/hide`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`POST hide: ${res.status}`);
      setFeed(
        (prev) =>
          prev && {
            ...prev,
            meetings: prev.meetings.filter((m) => m.id !== meetingId),
          }
      );
    } catch {
      setHideFailed(true);
    }
  }

  if (loadState === "loading") {
    return <ScreenState kind="loading">טוען פגישות…</ScreenState>;
  }
  if (loadState === "signed-out") {
    return (
      <ScreenState kind="notice" signIn>
        התחבר כדי לראות פגישות.
      </ScreenState>
    );
  }
  if (loadState === "not-found") {
    return (
      <ScreenState kind="notice">
        הקבוצה הזו לא נמצאה, או שאתה לא חבר בה.
      </ScreenState>
    );
  }
  if (loadState === "error" || !feed) {
    return (
      <ScreenState kind="error">
        לא הצלחנו לטעון את הפגישות. נסה לרענן את הדף.
      </ScreenState>
    );
  }

  const atCap = feed.openCount >= OPEN_MEETING_CAP;
  let dividerShown = false;

  return (
    <section className="sl-page">
      <h2 className="sl-sec">פגישות ({feed.openCount} פתוחות)</h2>

      {feed.meetings.length === 0 && (
        <ScreenState kind="empty">אין עדיין פגישות בקבוצה הזו.</ScreenState>
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
              {card.canHide && (
                <button
                  type="button"
                  onClick={() => hideMeeting(card.id)}
                  className="sl-sub self-start font-bold underline"
                >
                  הסר מהרשימה שלי
                </button>
              )}
            </div>
          );
        })}
      </div>

      {hideFailed && (
        <p className="sl-note">לא הצלחנו להסיר את הפגישה. נסה שוב.</p>
      )}

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

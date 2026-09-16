"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { APP_TIME_ZONE } from "@/lib/types/primitives";
import {
  MEETING_CARD_STATUS_LABELS,
  RESPONSE_STATUS_LABELS,
  unverifiedNote,
} from "@/lib/format/hebrew-labels";
import type { UnverifiedFact } from "@/lib/matching/constraints";

type MeetingCardStatus =
  | "waiting_on_you"
  | "waiting_on_others"
  | "reweighing"
  | "conflicting"
  | "stuck"
  | "closed";

type ResponseStatus = "pending" | "approved" | "cant_make_it" | "doesnt_suit";

type Proposal = {
  venueName: string;
  venueAddress: string | null;
  start: string;
  end: string;
  justification: string | null;
  unverified: UnverifiedFact[];
  alsoConsidered: string[];
};

type Participant = {
  userId: string;
  name: string;
  status: ResponseStatus;
  respondedAt: string | null;
};

type TimelineEvent =
  | { kind: "initiated"; at: string; by: string }
  | {
      kind: "proposed";
      at: string;
      cycleNumber: number;
      venueName: string;
      reweighedBecause: string | null;
    }
  | {
      kind: "response";
      at: string;
      by: string;
      status: ResponseStatus;
      reasonText: string | null;
    };

type MeetingDetail = {
  id: string;
  groupId: string;
  status: MeetingCardStatus;
  initiatorName: string;
  pinnedVenue: string | null;
  occasion: string | null;
  proposal: Proposal | null;
  participants: Participant[];
  approvedCount: number;
  totalCount: number;
  timeline: TimelineEvent[];
};

type LoadState = "loading" | "ready" | "signed-out" | "not-found" | "error";

const DATE_TIME_FMT = new Intl.DateTimeFormat("he-IL", {
  timeZone: APP_TIME_ZONE,
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
});

const TIME_FMT = new Intl.DateTimeFormat("he-IL", {
  timeZone: APP_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function formatRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  return `${DATE_TIME_FMT.format(start)} · ${TIME_FMT.format(start)}–${TIME_FMT.format(end)}`;
}

function ProposalBlock({ proposal }: { proposal: Proposal | null }) {
  const [expanded, setExpanded] = useState(false);

  if (!proposal) {
    return (
      <section className="flex flex-col gap-2 rounded-md border border-zinc-300 p-4 dark:border-zinc-700">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          ההצעה
        </h2>
        <p className="text-sm text-zinc-500">
          עדיין אין הצעה — הסוכן בוחן אפשרויות.
        </p>
      </section>
    );
  }

  const note = unverifiedNote(proposal.unverified);

  return (
    <section className="flex flex-col gap-2 rounded-md border border-zinc-300 p-4 dark:border-zinc-700">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        ההצעה
      </h2>
      <p className="text-base font-medium text-zinc-900 dark:text-zinc-50">
        {proposal.venueName}
      </p>
      {proposal.venueAddress && (
        <p className="text-sm text-zinc-500">{proposal.venueAddress}</p>
      )}
      <p className="text-sm text-zinc-500">
        {formatRange(proposal.start, proposal.end)}
      </p>

      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="self-start text-sm font-medium text-indigo-600 dark:text-indigo-400"
      >
        {expanded ? "הסתר" : "למה זה מתאים לך"}
      </button>
      {expanded && (
        <p className="rounded-md bg-zinc-100 p-3 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          {proposal.justification ?? "אין עדיין הסבר אישי עבורך."}
        </p>
      )}

      {note && <p className="text-xs text-amber-600">{note}</p>}

      {proposal.alsoConsidered.length > 0 && (
        <p className="text-xs text-zinc-500">
          גם שקלנו: {proposal.alsoConsidered.join(", ")}
        </p>
      )}
    </section>
  );
}

function StatusBlock({ detail }: { detail: MeetingDetail }) {
  return (
    <section className="flex flex-col gap-3 rounded-md border border-zinc-300 p-4 dark:border-zinc-700">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        איפה זה עומד
      </h2>
      <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900">
        <div
          className="h-full rounded-full bg-indigo-600"
          style={{
            width: `${detail.totalCount === 0 ? 0 : (detail.approvedCount / detail.totalCount) * 100}%`,
          }}
        />
      </div>
      <p className="text-sm text-zinc-500">
        {detail.approvedCount} מתוך {detail.totalCount} אישרו
      </p>

      <div className="flex flex-col gap-2">
        {detail.participants.map((p) => (
          <div
            key={p.userId}
            className="flex items-center justify-between text-sm"
          >
            <span className="text-zinc-900 dark:text-zinc-50">{p.name}</span>
            <span className="text-zinc-500">
              {RESPONSE_STATUS_LABELS[p.status]}
              {p.respondedAt &&
                ` · ${TIME_FMT.format(new Date(p.respondedAt))}`}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function timelineLine(event: TimelineEvent): string {
  if (event.kind === "initiated") return `${event.by} יזם/ה את הפגישה`;
  if (event.kind === "proposed") {
    const base =
      event.cycleNumber === 1
        ? `הוצעה ${event.venueName}`
        : `שוקלל מחדש ← ${event.venueName}`;
    return event.reweighedBecause
      ? `${base} (${event.reweighedBecause})`
      : base;
  }
  const label = RESPONSE_STATUS_LABELS[event.status];
  return event.reasonText
    ? `${event.by}: ${label} — "${event.reasonText}"`
    : `${event.by}: ${label}`;
}

function TimelineBlock({ timeline }: { timeline: TimelineEvent[] }) {
  return (
    <section className="flex flex-col gap-3 rounded-md border border-zinc-300 p-4 dark:border-zinc-700">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        מה קרה עד עכשיו
      </h2>
      <div className="flex flex-col gap-2">
        {timeline.map((event, i) => (
          <div key={i} className="text-sm">
            <p className="text-zinc-900 dark:text-zinc-50">
              {timelineLine(event)}
            </p>
            <p className="text-xs text-zinc-500">
              {TIME_FMT.format(new Date(event.at))}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function MeetingDetail({ meetingId }: { meetingId: string }) {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [detail, setDetail] = useState<MeetingDetail | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/meetings/${meetingId}`)
      .then((res) => {
        if (res.status === 401) {
          if (!cancelled) setLoadState("signed-out");
          return null;
        }
        if (res.status === 404) {
          if (!cancelled) setLoadState("not-found");
          return null;
        }
        if (!res.ok) throw new Error(`GET meeting: ${res.status}`);
        return res.json();
      })
      .then((body) => {
        if (cancelled || !body) return;
        setDetail(body);
        setLoadState("ready");
      })
      .catch(() => {
        if (!cancelled) setLoadState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  if (loadState === "loading") {
    return <p className="p-6 text-sm text-zinc-500">טוען את הפגישה…</p>;
  }
  if (loadState === "signed-out") {
    return <p className="p-6 text-sm text-zinc-500">התחבר כדי לראות פגישה.</p>;
  }
  if (loadState === "not-found") {
    return (
      <p className="p-6 text-sm text-zinc-500">
        הפגישה הזו לא נמצאה, או שאתה לא משתתף בה.
      </p>
    );
  }
  if (loadState === "error" || !detail) {
    return (
      <p className="p-6 text-sm text-red-600">
        לא הצלחנו לטעון את הפגישה. נסה לרענן את הדף.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <Link
        href={`/groups/${detail.groupId}`}
        className="self-start text-sm text-zinc-500"
      >
        &rsaquo; חזרה לקבוצה
      </Link>

      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-zinc-500">
          {MEETING_CARD_STATUS_LABELS[detail.status]}
        </span>
        {detail.occasion && (
          <span className="text-xs text-zinc-500">· {detail.occasion}</span>
        )}
      </div>

      <ProposalBlock proposal={detail.proposal} />
      <StatusBlock detail={detail} />
      <TimelineBlock timeline={detail.timeline} />
    </div>
  );
}

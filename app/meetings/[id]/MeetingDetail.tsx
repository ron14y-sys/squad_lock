"use client";

import { stickerClass } from "@/app/_components/meeting-style";
import { useEffect, useState } from "react";
import Link from "next/link";

import { APP_TIME_ZONE } from "@/lib/types/primitives";
import {
  MEETING_CARD_STATUS_LABELS,
  RESPONSE_STATUS_LABELS,
  unverifiedNote,
} from "@/lib/format/hebrew-labels";
import { ResponseControls } from "./respond/ResponseControls";
import { ConflictWarning, type Conflict } from "./respond/ConflictWarning";
import { StuckPanel } from "./StuckPanel";
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
  viewerId: string;
  remainingCycles: number;
  isStuck: boolean;
  isInitiator: boolean;
  conflicts: Conflict[];
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

function ProposalBlock({
  proposal,
  stuck,
}: {
  proposal: Proposal | null;
  stuck: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const heading = stuck ? "ההצעה הטובה ביותר שמצאנו" : "ההצעה";

  if (!proposal) {
    return (
      <section className="sl-panel">
        <h2 className="sl-sec">{heading}</h2>
        <p className="sl-sub">
          {stuck
            ? "לא נמצאה הצעה שמתאימה לכולם."
            : "עדיין אין הצעה — הסוכן בוחן אפשרויות."}
        </p>
      </section>
    );
  }

  const note = unverifiedNote(proposal.unverified);

  return (
    <section className="sl-panel">
      <h2 className="sl-sec">{heading}</h2>
      <p className="sl-ttl">{proposal.venueName}</p>
      {proposal.venueAddress && (
        <p className="sl-sub">{proposal.venueAddress}</p>
      )}
      <p className="sl-sub">{formatRange(proposal.start, proposal.end)}</p>

      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="sl-btn self-start"
      >
        {expanded ? "הסתר" : "למה זה מתאים לך"}
      </button>
      {expanded && (
        <p className="sl-line">
          {proposal.justification ?? "אין עדיין הסבר אישי עבורך."}
        </p>
      )}

      {note && <p className="sl-sub">{note}</p>}

      {proposal.alsoConsidered.length > 0 && (
        <p className="sl-sub">גם שקלנו: {proposal.alsoConsidered.join(", ")}</p>
      )}
    </section>
  );
}

function StatusBlock({ detail }: { detail: MeetingDetail }) {
  return (
    <section className="sl-panel">
      <h2 className="sl-sec">איפה זה עומד</h2>
      <div className="sl-seg" aria-hidden="true">
        {Array.from({ length: detail.totalCount }, (_, i) => (
          <i key={i} className={i < detail.approvedCount ? "on" : ""} />
        ))}
      </div>
      <p className="sl-line">
        {detail.approvedCount} מתוך {detail.totalCount} אישרו
      </p>

      <div className="flex flex-col gap-2">
        {detail.participants.map((p) => (
          <div
            key={p.userId}
            className="flex items-center justify-between text-sm font-bold"
          >
            <span>{p.name}</span>
            <span className="sl-sub">
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
    <section className="sl-panel">
      <h2 className="sl-sec">מה קרה עד עכשיו</h2>
      <ol className="sl-tl">
        {timeline.map((event, i) => (
          <li key={i}>
            {timelineLine(event)}
            <small className="sl-sub block">
              {TIME_FMT.format(new Date(event.at))}
            </small>
          </li>
        ))}
      </ol>
    </section>
  );
}

function loadDetail(
  meetingId: string,
  cancelledRef: { current: boolean },
  setLoadState: (s: LoadState) => void,
  setDetail: (d: MeetingDetail) => void
) {
  fetch(`/api/meetings/${meetingId}`)
    .then((res) => {
      if (res.status === 401) {
        if (!cancelledRef.current) setLoadState("signed-out");
        return null;
      }
      if (res.status === 404) {
        if (!cancelledRef.current) setLoadState("not-found");
        return null;
      }
      if (!res.ok) throw new Error(`GET meeting: ${res.status}`);
      return res.json();
    })
    .then((body) => {
      if (cancelledRef.current || !body) return;
      setDetail(body);
      setLoadState("ready");
    })
    .catch(() => {
      if (!cancelledRef.current) setLoadState("error");
    });
}

export function MeetingDetail({ meetingId }: { meetingId: string }) {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [detail, setDetail] = useState<MeetingDetail | null>(null);

  useEffect(() => {
    const cancelledRef = { current: false };
    loadDetail(meetingId, cancelledRef, setLoadState, setDetail);
    return () => {
      cancelledRef.current = true;
    };
  }, [meetingId]);

  function refresh() {
    loadDetail(meetingId, { current: false }, setLoadState, setDetail);
  }

  if (loadState === "loading") {
    return <p className="sl-page sl-sub">טוען את הפגישה…</p>;
  }
  if (loadState === "signed-out") {
    return <p className="sl-page sl-sub">התחבר כדי לראות פגישה.</p>;
  }
  if (loadState === "not-found") {
    return (
      <p className="sl-page sl-sub">
        הפגישה הזו לא נמצאה, או שאתה לא משתתף בה.
      </p>
    );
  }
  if (loadState === "error" || !detail) {
    return (
      <p className="sl-page sl-sub">
        לא הצלחנו לטעון את הפגישה. נסה לרענן את הדף.
      </p>
    );
  }

  return (
    <div className="sl-page">
      <Link href={`/groups/${detail.groupId}`} className="sl-sub self-start">
        &rsaquo; חזרה לקבוצה
      </Link>

      <div className="flex items-center gap-2">
        <span className={`sl-stk ${stickerClass(detail.status)}`}>
          {MEETING_CARD_STATUS_LABELS[detail.status]}
        </span>
        {detail.occasion && <span className="sl-sub">· {detail.occasion}</span>}
      </div>

      {detail.isStuck && (
        <StuckPanel
          meetingId={detail.id}
          groupId={detail.groupId}
          initiatorName={detail.initiatorName}
          isInitiator={detail.isInitiator}
          hasProposal={detail.proposal !== null}
          rejections={detail.timeline.flatMap((event) =>
            event.kind === "response" &&
            event.status === "doesnt_suit" &&
            event.reasonText
              ? [{ by: event.by, reasonText: event.reasonText }]
              : []
          )}
          onCancelled={refresh}
        />
      )}
      <ProposalBlock proposal={detail.proposal} stuck={detail.isStuck} />
      <ResponseControls
        meetingId={detail.id}
        myStatus={
          detail.participants.find((p) => p.userId === detail.viewerId)
            ?.status ?? "pending"
        }
        remainingCycles={detail.remainingCycles}
        disabled={detail.status === "closed"}
        onResponded={refresh}
        aboveApprove={
          detail.conflicts.length > 0 ? (
            <ConflictWarning
              meetingId={detail.id}
              thisMeetingName={
                detail.proposal?.venueName ?? detail.occasion ?? "ללא שם"
              }
              conflicts={detail.conflicts}
              onResolved={refresh}
            />
          ) : undefined
        }
      />
      <StatusBlock detail={detail} />
      <TimelineBlock timeline={detail.timeline} />
    </div>
  );
}

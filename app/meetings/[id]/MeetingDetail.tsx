"use client";

import { stickerClass } from "@/app/_components/meeting-style";
import { useEffect, useState } from "react";
import Link from "next/link";

import { APP_TIME_ZONE } from "@/lib/types/primitives";
import {
  meetingStatusLabel,
  RESPONSE_STATUS_LABELS,
  RUN_STAGE_LABELS,
  unverifiedNote,
} from "@/lib/format/hebrew-labels";
import type { RunStage } from "@/lib/generated/prisma/enums";
import { ResponseControls } from "./respond/ResponseControls";
import { ConflictWarning, type Conflict } from "./respond/ConflictWarning";
import { StuckPanel } from "./StuckPanel";
import type { UnverifiedFact } from "@/lib/matching/constraints";
import { ScreenState } from "@/app/_components/ScreenState";

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
  venueType: string | null;
  venueSummary: string | null;
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
    }
  | {
      /** B11: "my situation tonight is different" — shown the moment it
       * is made, mirrored from `lib/db/meeting-detail.ts`'s own TimelineEvent. */
      kind: "amendment";
      at: string;
      by: string;
      description: string;
    };

type MissingHome = { userId: string; name: string };

type MeetingDetail = {
  id: string;
  groupId: string;
  status: MeetingCardStatus;
  viewerId: string;
  remainingCycles: number;
  viewerAmendmentIsFree: boolean;
  isStuck: boolean;
  isInitiator: boolean;
  conflicts: Conflict[];
  missingHome: MissingHome[];
  calendarMissing: MissingHome[];
  retryInMinutes: number | null;
  initiatorName: string;
  pinnedVenue: string | null;
  occasion: string | null;
  proposal: Proposal | null;
  runStage: RunStage | null;
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
      {(proposal.venueType || proposal.venueSummary) && (
        <p className="sl-sub">
          {[proposal.venueType, proposal.venueSummary]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
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

/**
 * #169: once a rejection sends a meeting back to `reweighing`, the old
 * proposal is no longer on the table — showing it (and its approve/reject
 * buttons) invites acting on something already gone. This replaces it until
 * the poll above lands the next one. `runStage` is null during the short
 * batching window before the run itself starts (spec's own convention, #155).
 */
function ReweighingBlock({
  runStage,
  firstSearch,
}: {
  runStage: RunStage | null;
  /** No proposal has ever been made — the opening search, not a new one. */
  firstSearch: boolean;
}) {
  const heading = firstSearch ? "מחפשים הצעה" : "מחפשים הצעה חדשה";
  return (
    <section className="sl-panel" role="status" aria-busy="true">
      <h2 className="sl-sec">{heading}</h2>
      <div className="sl-skel" aria-hidden="true" />
      <p className="sl-sub">
        {runStage ? RUN_STAGE_LABELS[runStage] : `${heading}…`}
      </p>
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
  if (event.kind === "amendment")
    return `${event.by} עדכנ/ה את המצב: "${event.description}"`;
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

/**
 * #132: a person with no home point makes the agent refuse to weigh the
 * group, and from outside that looks like "no proposal, no reason". Name who
 * is missing and, for the viewer themselves, say where to fix it.
 */
function MissingHomeNotice({
  missing,
  viewerId,
}: {
  missing: MissingHome[];
  viewerId: string;
}) {
  const mine = missing.some((p) => p.userId === viewerId);
  const others = missing.filter((p) => p.userId !== viewerId);

  return (
    <div role="alert" className="sl-warn flex flex-col gap-2">
      <p className="font-bold">אי אפשר להכין הצעה עדיין</p>
      {mine && (
        <p>
          עוד לא הגדרת שכונת מגורים.{" "}
          <Link href="/profile/location" className="font-bold underline">
            הגדר עכשיו
          </Link>
        </p>
      )}
      {others.length > 0 && (
        <p>
          {others.map((p) => p.name).join(", ")}{" "}
          {others.length === 1 ? "עוד לא הגדיר/ה" : "עוד לא הגדירו"} שכונת
          מגורים. בלי זה אי אפשר למצוא מקום שמתאים לכולם.
        </p>
      )}
    </div>
  );
}

/**
 * B9 part five: why a meeting that is still being weighed is not moving. Two
 * causes the group can actually do something about or at least understand:
 * somebody's calendar connection is gone (`calendarMissing`), or an outside
 * service told us to slow down (`retryInMinutes`). Everything else that
 * goes wrong in a run is ours to fix, and says nothing here.
 */
function WeighingBlockedNotice({
  meetingId,
  calendarMissing,
  retryInMinutes,
  viewerId,
}: {
  meetingId: string;
  calendarMissing: MissingHome[];
  retryInMinutes: number | null;
  viewerId: string;
}) {
  // Same route B10's email uses: it starts Google's consent directly (not
  // `/api/auth/signin`, which bounces a signed-in person to /groups), then
  // lands the person back here.
  const connectHref = `/api/calendar/connect?callbackUrl=${encodeURIComponent(
    `/meetings/${meetingId}`
  )}`;
  const mine = calendarMissing.some((p) => p.userId === viewerId);
  const others = calendarMissing.filter((p) => p.userId !== viewerId);

  return (
    <div role="status" className="sl-warn flex flex-col gap-2">
      <p className="font-bold">
        {calendarMissing.length > 0 ? "ההצעה תקועה" : "ההתאמה מחכה"}
      </p>
      {mine && (
        <p>
          לא חיברת יומן, ובלעדיו אי אפשר לבדוק מתי אתה פנוי.{" "}
          <Link href={connectHref} className="font-bold underline">
            חבר יומן
          </Link>
        </p>
      )}
      {others.length > 0 && (
        <p>
          {others.map((p) => p.name).join(", ")}{" "}
          {others.length === 1 ? "עוד לא חיבר/ה" : "עוד לא חיברו"} יומן, ולכן
          ההצעה תקועה עד {others.length === 1 ? "שיתחבר/תתחבר" : "שיתחברו"}.
        </p>
      )}
      {retryInMinutes !== null && (
        <p>
          אחד השירותים שאנחנו משתמשים בהם מגביל אותנו כרגע. ננסה שוב{" "}
          {retryInMinutes === 1 ? "בעוד כדקה" : `בעוד כ-${retryInMinutes} דקות`}
          .
        </p>
      )}
    </div>
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

  // While a re-weighing is under way, ask again every three seconds — the
  // same cadence as the feed, and what makes the route above run it. A failed
  // poll keeps the page on screen; the next one tries again.
  // Blocked on a missing calendar, nothing is about to change: no fast poll.
  const reweighing =
    detail?.status === "reweighing" && detail.calendarMissing.length === 0;
  useEffect(() => {
    if (!reweighing) return;
    const cancelledRef = { current: false };
    const intervalId = setInterval(() => {
      // Backgrounded: no requests (spec §5.6).
      if (document.visibilityState !== "visible") return;
      loadDetail(
        meetingId,
        cancelledRef,
        (s) => s !== "error" && setLoadState(s),
        setDetail
      );
    }, 3000);
    return () => {
      cancelledRef.current = true;
      clearInterval(intervalId);
    };
  }, [meetingId, reweighing]);

  function refresh() {
    loadDetail(meetingId, { current: false }, setLoadState, setDetail);
  }

  if (loadState === "loading") {
    return <ScreenState kind="loading">טוען את הפגישה…</ScreenState>;
  }
  if (loadState === "signed-out") {
    return (
      <ScreenState kind="notice" signIn>
        התחבר כדי לראות פגישה.
      </ScreenState>
    );
  }
  if (loadState === "not-found") {
    return (
      <ScreenState kind="notice">
        הפגישה הזו לא נמצאה, או שאתה לא משתתף בה.
      </ScreenState>
    );
  }
  if (loadState === "error" || !detail) {
    return (
      <ScreenState kind="error">
        לא הצלחנו לטעון את הפגישה. נסה לרענן את הדף.
      </ScreenState>
    );
  }

  // A run refuses to guess anyone free, so with a calendar missing the
  // meeting is stuck, not searching — the notice says who and how to fix it.
  const calendarBlocked =
    detail.status === "reweighing" && detail.calendarMissing.length > 0;

  return (
    <div className="sl-page">
      <Link href={`/groups/${detail.groupId}`} className="sl-sub self-start">
        &rsaquo; חזרה לקבוצה
      </Link>

      <div className="flex items-center gap-2">
        <span
          className={`sl-stk ${stickerClass(detail.status, calendarBlocked)}`}
        >
          {meetingStatusLabel(
            detail.status,
            null,
            detail.proposal === null,
            calendarBlocked
          )}
        </span>
      </div>

      {/* What the meeting is for is what a person looks for first — the
          page's heading, not a grey aside next to the status. */}
      {detail.occasion && (
        <h1
          className="sl-sec text-balance"
          style={{ fontSize: 28, lineHeight: 1.15 }}
        >
          {detail.occasion}
        </h1>
      )}

      {detail.missingHome.length > 0 && (
        <MissingHomeNotice
          missing={detail.missingHome}
          viewerId={detail.viewerId}
        />
      )}
      {!detail.isStuck &&
        (detail.calendarMissing.length > 0 ||
          detail.retryInMinutes !== null) && (
          <WeighingBlockedNotice
            meetingId={detail.id}
            calendarMissing={detail.calendarMissing}
            retryInMinutes={detail.retryInMinutes}
            viewerId={detail.viewerId}
          />
        )}
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
      {calendarBlocked ? null : reweighing && !detail.isStuck ? (
        <ReweighingBlock
          runStage={detail.runStage}
          firstSearch={detail.proposal === null}
        />
      ) : (
        <>
          <ProposalBlock proposal={detail.proposal} stuck={detail.isStuck} />
          <ResponseControls
            meetingId={detail.id}
            myStatus={
              detail.participants.find((p) => p.userId === detail.viewerId)
                ?.status ?? "pending"
            }
            remainingCycles={detail.remainingCycles}
            amendmentIsFree={detail.viewerAmendmentIsFree}
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
        </>
      )}
      <StatusBlock detail={detail} />
      <TimelineBlock timeline={detail.timeline} />
    </div>
  );
}

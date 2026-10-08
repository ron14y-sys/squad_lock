"use client";

import { useState, type ReactNode } from "react";
import type { Kilometres } from "@/lib/types";
import {
  NEIGHBOURHOODS,
  NEIGHBOURHOOD_GROUPS,
  findNeighbourhoodById,
} from "@/lib/geo/neighbourhoods";
import { TOLERANCE_OPTIONS } from "@/lib/preferences/tolerance";

type ResponseStatus = "pending" | "approved" | "cant_make_it" | "doesnt_suit";

type Mode = "car" | "transit" | "walk";

type Open = "none" | "doesnt_suit" | "amendment";

const MODE_LABELS: Record<Mode, string> = {
  car: "רכב",
  transit: "תחבורה ציבורית",
  walk: "הליכה",
};

const KNOWN_ERRORS: Record<string, string> = {
  "This meeting is no longer open.": "הפגישה הזו כבר לא פתוחה לתגובות.",
  "Meeting not found.": "הפגישה הזו לא נמצאה.",
  "Invalid response.": "בדוק את הפרטים ונסה שוב.",
};

/**
 * The fourth control (spec §3.2): approve · can't make it · something
 * doesn't work · my situation tonight is different. Four, not three — a
 * single reject button used to carry two meanings, and splitting it
 * revealed a third that isn't a rejection at all.
 *
 * The amendment form: an origin, how far that makes tonight's travel
 * (#222), one mobility mode marked unavailable, and free text — sent as a
 * `ParticipantMeetingContext` scoped to this one meeting, so a
 * recurring-style weekday/time window would be redundant. `weekdays: []`
 * (every day) with a full-day window is correct here, not a shortcut: the
 * amendment is only ever checked against this meeting's own proposed slot,
 * never against any other day.
 *
 * The origin is the same fixed neighbourhood list the profile's own
 * location picker uses (`lib/geo/neighbourhoods.ts`), not free text or a
 * geocoding call — #222's bug fix: a typed label was never resolved to
 * coordinates, so the burden was still measured from home no matter what
 * anyone wrote here. Same reasoning the profile's picker already settled:
 * a checked-in list costs nothing and never leaks more than a
 * neighbourhood (spec §5.4), where a live autocomplete would spend the
 * project's limited Places quota on every amendment.
 *
 * #223: "לא לפני / לא אחרי" is this meeting's own start window, sent as
 * `earliestStart`/`latestStart` — not the weekly recurring rule the profile
 * already has, which this amendment deliberately does not touch.
 */
export function ResponseControls({
  meetingId,
  myStatus,
  remainingCycles,
  amendmentIsFree,
  disabled,
  onResponded,
  aboveApprove,
}: {
  meetingId: string;
  myStatus: ResponseStatus;
  remainingCycles: number;
  /** B11: whether an amendment submitted right now would be the viewer's
   * free one for this meeting (spec §3.1) — `getMeetingDetail`'s
   * `viewerAmendmentIsFree`, read-side mirror of `respondToMeeting`'s own
   * `priorAmendments` count. Drives which half of the amendment form's
   * copy is shown. */
  amendmentIsFree: boolean;
  disabled: boolean;
  onResponded: () => void;
  /** Rendered directly above the approve button — the conflict warning lives here (spec §5.7). */
  aboveApprove?: ReactNode;
}) {
  const [open, setOpen] = useState<Open>("none");
  const [reasonText, setReasonText] = useState("");
  const [originId, setOriginId] = useState("");
  const [toleranceKm, setToleranceKm] = useState<Kilometres | "">("");
  const [earliestStart, setEarliestStart] = useState("");
  const [latestStart, setLatestStart] = useState("");
  const [unavailableMode, setUnavailableMode] = useState<Mode | "">("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function send(body: Record<string, unknown>) {
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const responseBody = await res.json();
        setMessage(
          KNOWN_ERRORS[responseBody.error] ?? "לא הצלחנו לשלוח. נסה שוב."
        );
        return;
      }
      setOpen("none");
      setReasonText("");
      setOriginId("");
      setToleranceKm("");
      setEarliestStart("");
      setLatestStart("");
      setUnavailableMode("");
      setNote("");
      onResponded();
    } catch {
      setMessage("לא הצלחנו לשלוח. נסה שוב.");
    } finally {
      setSubmitting(false);
    }
  }

  function submitAmendment() {
    const mobilityWindows = unavailableMode
      ? [
          {
            mode: unavailableMode,
            available: false,
            window: { weekdays: [], from: "00:00", to: "23:59" },
          },
        ]
      : undefined;
    // #222: origin and its label move together, from the one neighbourhood
    // picked — never a label with no coordinates, and never the reverse.
    const neighbourhood = originId
      ? findNeighbourhoodById(originId)
      : undefined;

    send({
      kind: "amendment",
      ...(neighbourhood && {
        origin: neighbourhood.centre,
        originLabel: neighbourhood.label,
      }),
      ...(toleranceKm && { toleranceKm }),
      ...(earliestStart && { earliestStart }),
      ...(latestStart && { latestStart }),
      ...(mobilityWindows && { mobilityWindows }),
      ...(note.trim() && { note: note.trim() }),
    });
  }

  const amendmentEmpty =
    !originId &&
    !toleranceKm &&
    !earliestStart &&
    !latestStart &&
    !unavailableMode &&
    !note.trim();

  return (
    <section className="sl-page !p-0">
      <h2 className="sl-sec">התגובה שלך</h2>

      {aboveApprove}

      <div className="sl-row">
        <button
          type="button"
          disabled={disabled || submitting || myStatus === "approved"}
          onClick={() => send({ kind: "approve" })}
          className="sl-btn go"
        >
          מאשר/ת
        </button>
        <button
          type="button"
          disabled={disabled || submitting || myStatus === "cant_make_it"}
          onClick={() => send({ kind: "cant_make_it" })}
          className="sl-btn"
        >
          לא יכול/ה להגיע
        </button>
        <button
          type="button"
          disabled={disabled || submitting}
          onClick={() =>
            setOpen(open === "doesnt_suit" ? "none" : "doesnt_suit")
          }
          className="sl-btn"
        >
          משהו כאן לא מתאים לי
        </button>
        <button
          type="button"
          disabled={disabled || submitting}
          onClick={() => setOpen(open === "amendment" ? "none" : "amendment")}
          className="sl-btn"
        >
          המצב שלי הערב שונה
        </button>
      </div>

      {open === "doesnt_suit" && (
        <div className="sl-panel">
          <p className="sl-sub">
            נותרו {remainingCycles} ניסיונות למצוא הצעה חלופית.
          </p>
          <textarea
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
            placeholder="מה לא מתאים?"
            className="sl-field"
          />
          <button
            type="button"
            disabled={submitting || !reasonText.trim()}
            onClick={() =>
              send({ kind: "doesnt_suit", reasonText: reasonText.trim() })
            }
            className="sl-btn go self-start"
          >
            שלח
          </button>
        </div>
      )}

      {open === "amendment" && (
        <div className="sl-panel">
          <p className="sl-sub">
            {amendmentIsFree
              ? "זה לא דחייה — ההצעה תישקל מחדש עם המידע הזה. זה התיקון החינמי שלך לפגישה הזו, והוא לא ייספר כניסיון; תיקון נוסף כבר יעלה סבב שקלול."
              : `זה לא דחייה — ההצעה תישקל מחדש עם המידע הזה. התיקון החינמי כבר נוצל בפגישה הזו, אז הפעם זה כן יעלה סבב שקלול (נשארו ${remainingCycles} ניסיונות).`}
          </p>
          <label className="flex flex-col gap-1">
            <span className="sl-sub">מגיע/ה מ... (אופציונלי)</span>
            <select
              value={originId}
              onChange={(e) => setOriginId(e.target.value)}
              className="sl-field"
            >
              <option value="">—</option>
              {NEIGHBOURHOOD_GROUPS.map((group) => (
                <optgroup key={group} label={group}>
                  {NEIGHBOURHOODS.filter((n) => n.group === group).map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-1">
            <span className="sl-sub">
              עד כמה אני מוכן/ה לנסוע הערב (אופציונלי)
            </span>
            <div className="flex flex-wrap gap-2">
              {TOLERANCE_OPTIONS.map((option) => {
                const active = option.km === toleranceKm;
                return (
                  <button
                    key={option.label}
                    type="button"
                    onClick={() => setToleranceKm(active ? "" : option.km)}
                    aria-pressed={active}
                    className={active ? "sl-chip on" : "sl-chip"}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="sl-sub">מתי אני יכול/ה הערב (אופציונלי)</span>
            <div className="flex items-center gap-2">
              <span className="sl-sub">לא לפני</span>
              <input
                type="time"
                value={earliestStart}
                onChange={(e) => setEarliestStart(e.target.value)}
                aria-label="לא לפני"
                className="sl-field w-auto"
              />
              <span className="sl-sub">לא אחרי</span>
              <input
                type="time"
                value={latestStart}
                onChange={(e) => setLatestStart(e.target.value)}
                aria-label="לא אחרי"
                className="sl-field w-auto"
              />
            </div>
          </div>
          <label className="flex flex-col gap-1">
            <span className="sl-sub">אין לי הערב (אופציונלי)</span>
            <select
              value={unavailableMode}
              onChange={(e) => setUnavailableMode(e.target.value as Mode | "")}
              className="sl-field"
            >
              <option value="">—</option>
              {(Object.keys(MODE_LABELS) as Mode[]).map((mode) => (
                <option key={mode} value={mode}>
                  {MODE_LABELS[mode]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="sl-sub">הערה חופשית (אופציונלי)</span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="sl-field"
            />
          </label>
          <button
            type="button"
            disabled={submitting || amendmentEmpty}
            onClick={submitAmendment}
            className="sl-btn go self-start"
          >
            עדכן
          </button>
        </div>
      )}

      {message && <p className="sl-note">{message}</p>}
    </section>
  );
}

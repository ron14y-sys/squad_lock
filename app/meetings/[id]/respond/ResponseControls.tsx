"use client";

import { useState, type ReactNode } from "react";

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
 * The amendment form is deliberately minimal: origin label, one mobility
 * mode marked unavailable, and free text — sent as a `ParticipantMeetingContext`
 * scoped to this one meeting, so a recurring-style weekday/time window would
 * be redundant. `weekdays: []` (every day) with a full-day window is correct
 * here, not a shortcut: the amendment is only ever checked against this
 * meeting's own proposed slot, never against any other day.
 */
export function ResponseControls({
  meetingId,
  myStatus,
  remainingCycles,
  disabled,
  onResponded,
  aboveApprove,
}: {
  meetingId: string;
  myStatus: ResponseStatus;
  remainingCycles: number;
  disabled: boolean;
  onResponded: () => void;
  /** Rendered directly above the approve button — the conflict warning lives here (spec §5.7). */
  aboveApprove?: ReactNode;
}) {
  const [open, setOpen] = useState<Open>("none");
  const [reasonText, setReasonText] = useState("");
  const [originLabel, setOriginLabel] = useState("");
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
      setOriginLabel("");
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

    send({
      kind: "amendment",
      ...(originLabel.trim() && { originLabel: originLabel.trim() }),
      ...(mobilityWindows && { mobilityWindows }),
      ...(note.trim() && { note: note.trim() }),
    });
  }

  const amendmentEmpty =
    !originLabel.trim() && !unavailableMode && !note.trim();

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
            זה לא דחייה — ההצעה תישקל מחדש עם המידע הזה, ולא ייספר לך כניסיון.
          </p>
          <label className="flex flex-col gap-1">
            <span className="sl-sub">מגיע/ה מ... (אופציונלי)</span>
            <input
              type="text"
              value={originLabel}
              onChange={(e) => setOriginLabel(e.target.value)}
              placeholder="לדוגמה: מהעבודה"
              className="sl-field"
            />
          </label>
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

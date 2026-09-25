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
    <section className="flex flex-col gap-3 rounded-md border border-zinc-300 p-4 dark:border-zinc-700">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        התגובה שלך
      </h2>

      {aboveApprove}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled || submitting || myStatus === "approved"}
          onClick={() => send({ kind: "approve" })}
          className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          מאשר/ת
        </button>
        <button
          type="button"
          disabled={disabled || submitting || myStatus === "cant_make_it"}
          onClick={() => send({ kind: "cant_make_it" })}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
        >
          לא יכול/ה להגיע
        </button>
        <button
          type="button"
          disabled={disabled || submitting}
          onClick={() =>
            setOpen(open === "doesnt_suit" ? "none" : "doesnt_suit")
          }
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
        >
          משהו כאן לא מתאים לי
        </button>
        <button
          type="button"
          disabled={disabled || submitting}
          onClick={() => setOpen(open === "amendment" ? "none" : "amendment")}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
        >
          המצב שלי הערב שונה
        </button>
      </div>

      {open === "doesnt_suit" && (
        <div className="flex flex-col gap-2 rounded-md bg-zinc-100 p-3 dark:bg-zinc-900">
          <p className="text-xs text-zinc-500">
            נותרו {remainingCycles} ניסיונות למצוא הצעה חלופית.
          </p>
          <textarea
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
            placeholder="מה לא מתאים?"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-black"
          />
          <button
            type="button"
            disabled={submitting || !reasonText.trim()}
            onClick={() =>
              send({ kind: "doesnt_suit", reasonText: reasonText.trim() })
            }
            className="self-start rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-black"
          >
            שלח
          </button>
        </div>
      )}

      {open === "amendment" && (
        <div className="flex flex-col gap-2 rounded-md bg-zinc-100 p-3 dark:bg-zinc-900">
          <p className="text-xs text-zinc-500">
            זה לא דחייה — ההצעה תישקל מחדש עם המידע הזה, ולא ייספר לך כניסיון.
          </p>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-zinc-700 dark:text-zinc-300">
              מגיע/ה מ... (אופציונלי)
            </span>
            <input
              type="text"
              value={originLabel}
              onChange={(e) => setOriginLabel(e.target.value)}
              placeholder="לדוגמה: מהעבודה"
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-black"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-zinc-700 dark:text-zinc-300">
              אין לי הערב (אופציונלי)
            </span>
            <select
              value={unavailableMode}
              onChange={(e) => setUnavailableMode(e.target.value as Mode | "")}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-black"
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
            <span className="text-xs text-zinc-700 dark:text-zinc-300">
              הערה חופשית (אופציונלי)
            </span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-black"
            />
          </label>
          <button
            type="button"
            disabled={submitting || amendmentEmpty}
            onClick={submitAmendment}
            className="self-start rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-black"
          >
            עדכן
          </button>
        </div>
      )}

      {message && <p className="text-sm text-red-600">{message}</p>}
    </section>
  );
}

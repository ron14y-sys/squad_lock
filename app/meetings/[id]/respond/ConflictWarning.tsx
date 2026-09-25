"use client";

import { useState } from "react";

import { APP_TIME_ZONE } from "@/lib/types/primitives";

export type Conflict = {
  meetingId: string;
  groupName: string;
  venueName: string | null;
  start: string | null;
};

const WHEN_FMT = new Intl.DateTimeFormat("he-IL", {
  timeZone: APP_TIME_ZONE,
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const KNOWN_ERRORS: Record<string, string> = {
  "Meeting not found.": "הפגישה הזו לא נמצאה.",
  "This meeting can no longer be sent back to weighing.":
    "אי אפשר להחזיר את הפגישה הזו לשקלול כרגע.",
};

function describe(conflict: Conflict): string {
  const parts = [conflict.groupName];
  if (conflict.venueName) parts.push(conflict.venueName);
  parts.push(
    conflict.start ? WHEN_FMT.format(new Date(conflict.start)) : "טרם נקבע זמן"
  );
  return parts.join(" · ");
}

/**
 * The third place a clash surfaces (spec §5.7) and the one that matters most:
 * directly above the approve button, saying what approving would do to the
 * other meeting *before* the press. Two ways out, not one — a rule as blunt
 * as "same day, under four hours apart" produces false positives, and
 * without an exit the only choices would be to approve (undoing an evening
 * other people already agreed to) or to do nothing.
 */
function ConflictItem({
  meetingId,
  thisMeetingName,
  conflict,
  onResolved,
}: {
  meetingId: string;
  thisMeetingName: string;
  conflict: Conflict;
  onResolved: () => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function send(body: Record<string, string>) {
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/conflict`, {
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
      onResolved();
    } catch {
      setMessage("לא הצלחנו לשלוח. נסה שוב.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-md border border-amber-500 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200"
    >
      <p className="font-medium">
        יש לך פגישה נוספת באותו ערב: {describe(conflict)}
      </p>
      <p>אם תאשר את הפגישה הזו, הפגישה ההיא תחזור לשקלול בלעדייך.</p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={submitting}
          onClick={() =>
            send({ kind: "keep_both", otherMeetingId: conflict.meetingId })
          }
          className="rounded-md border border-amber-600 px-3 py-1.5 text-sm disabled:opacity-50"
        >
          אלה לא מתנגשות — השאר את שתיהן
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={() => setChoosing((c) => !c)}
          className="rounded-md border border-amber-600 px-3 py-1.5 text-sm disabled:opacity-50"
        >
          אחת מהן צריכה להשתנות
        </button>
      </div>

      {choosing && (
        <div className="flex flex-col gap-2">
          <p>איזו מהן לשנות? היא תחזור לשקלול מחדש.</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() =>
                send({ kind: "send_back", targetMeetingId: meetingId })
              }
              className="rounded-md bg-amber-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              שנה את הפגישה הזו ({thisMeetingName})
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() =>
                send({
                  kind: "send_back",
                  targetMeetingId: conflict.meetingId,
                })
              }
              className="rounded-md bg-amber-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              שנה את הפגישה ב{conflict.groupName}
            </button>
          </div>
        </div>
      )}

      {message && <p className="text-red-600">{message}</p>}
    </div>
  );
}

export function ConflictWarning({
  meetingId,
  thisMeetingName,
  conflicts,
  onResolved,
}: {
  meetingId: string;
  thisMeetingName: string;
  conflicts: Conflict[];
  onResolved: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {conflicts.map((conflict) => (
        <ConflictItem
          key={conflict.meetingId}
          meetingId={meetingId}
          thisMeetingName={thisMeetingName}
          conflict={conflict}
          onResolved={onResolved}
        />
      ))}
    </div>
  );
}

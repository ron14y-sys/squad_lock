"use client";

import { useState } from "react";
import Link from "next/link";

export type Rejection = { by: string; reasonText: string };

const KNOWN_ERRORS: Record<string, string> = {
  "Only the initiator can cancel a meeting.":
    "רק מי שפתח את הפגישה יכול לבטל אותה.",
  "Only a stuck meeting can be cancelled.": "הפגישה הזו כבר לא תקועה.",
  "Meeting not found.": "הפגישה הזו לא נמצאה.",
};

/**
 * What a stuck meeting shows instead of going quiet (spec §3.1, C8b): why the
 * search stopped, what people said along the way, and how the group settles
 * it themselves. Without this a capped meeting just disappears from view,
 * which is the same failure as an endless loop with better manners.
 *
 * The best option found is not drawn here — it is the proposal block above,
 * relabelled for a stuck meeting.
 */
export function StuckPanel({
  meetingId,
  groupId,
  initiatorName,
  isInitiator,
  hasProposal,
  rejections,
  onCancelled,
}: {
  meetingId: string;
  groupId: string;
  initiatorName: string;
  isInitiator: boolean;
  hasProposal: boolean;
  rejections: Rejection[];
  onCancelled: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function cancel() {
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/cancel`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json();
        setMessage(KNOWN_ERRORS[body.error] ?? "לא הצלחנו לבטל. נסה שוב.");
        return;
      }
      onCancelled();
    } catch {
      setMessage("לא הצלחנו לבטל. נסה שוב.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border border-amber-500 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
      <h2 className="font-semibold">הפגישה הזו תקועה</h2>
      <p>
        ניסינו שלוש פעמים ולא מצאנו הצעה שמתאימה לכולם, אז המערכת מפסיקה לחפש
        ומעבירה את ההחלטה אליכם.
      </p>

      {rejections.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="font-medium">מה נאמר בדרך:</p>
          <ul className="list-disc ps-5">
            {rejections.map((r, i) => (
              <li key={i}>
                {r.by}: &quot;{r.reasonText}&quot;
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <p className="font-medium">איך מסיימים את זה:</p>
        <ol className="list-decimal ps-5">
          {hasProposal && (
            <li>
              מאשרים את ההצעה הטובה ביותר שמצאנו (למעלה) — כל אחד בכפתור
              &quot;מאשר/ת&quot; למטה.
            </li>
          )}
          <li>
            או מסכמים ביניכם מחוץ לאפליקציה,{" "}
            <Link href={`/groups/${groupId}/new`} className="underline">
              ופותחים פגישה חדשה
            </Link>{" "}
            עם תאריך ומקום קבועים.
          </li>
        </ol>
      </div>

      {isInitiator ? (
        <div className="flex flex-col gap-2">
          <p>
            פגישה תקועה תופסת אחד משלושת המקומות הפתוחים של הקבוצה. אם החלטתם
            לוותר עליה, אפשר לבטל אותה ולפנות את המקום.
          </p>
          {confirming ? (
            <div className="flex flex-wrap items-center gap-2">
              <span>לבטל לכולם?</span>
              <button
                type="button"
                disabled={submitting}
                onClick={cancel}
                className="rounded-md bg-amber-700 px-3 py-1.5 text-white disabled:opacity-50"
              >
                כן, בטל
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => setConfirming(false)}
                className="rounded-md border border-amber-600 px-3 py-1.5 disabled:opacity-50"
              >
                לא
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="self-start rounded-md border border-amber-600 px-3 py-1.5"
            >
              בטל את הפגישה
            </button>
          )}
        </div>
      ) : (
        <p>רק {initiatorName}, שפתח/ה את הפגישה, יכול/ה לבטל אותה.</p>
      )}

      {message && <p className="text-red-600">{message}</p>}
    </section>
  );
}

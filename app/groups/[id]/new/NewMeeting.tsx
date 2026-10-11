"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ScreenState } from "@/app/_components/ScreenState";
import type { TimeOfDayPart } from "@/lib/types";

type SubmitState = "idle" | "submitting" | "signed-out" | "not-found" | "error";

/** #168: replaces the exact-time field, which nothing ever read. */
const PARTS: { value: TimeOfDayPart; label: string }[] = [
  { value: "morning", label: "בוקר" },
  { value: "midday", label: "צהריים" },
  { value: "evening", label: "ערב" },
];

const KNOWN_ERRORS: Record<string, string> = {
  "Body must be JSON.": "משהו השתבש. נסה שוב.",
  "Invalid meeting.": "בדוק את הפרטים שמילאת ונסה שוב.",
};

function capReachedMessage(message: string): string | null {
  // OpenMeetingCapReachedError's text, e.g. "Group g1 already has 3 open meetings."
  if (!/already has \d+ open meetings\./.test(message)) return null;
  return "כבר יש 3 פגישות פתוחות בקבוצה. סגרו אחת כדי לפתוח חדשה.";
}

/**
 * #240: the venue typed was not found, or is not a restaurant, bar or café.
 * The server counts the misses; `attemptsLeft` is how many it will still try.
 */
export const VENUE_LOCKED_MESSAGE =
  "לא הצלחנו לזהות את המקום. אפשר לפתוח את הפגישה בלי מקום מסוים, והסוכן יבחר.";

function venueMessage(body: {
  error?: string;
  venue?: string;
  attemptsLeft?: number;
}): string | null {
  if (body.error === "venue_lookup_blocked") return VENUE_LOCKED_MESSAGE;
  const problem =
    body.error === "venue_not_found"
      ? `לא מצאנו מקום בשם ״${body.venue}״. אולי יש טעות בשם?`
      : body.error === "venue_not_a_venue"
        ? `״${body.venue}״ הוא לא מסעדה, בר או בית קפה. יכול להיות שהתבלבלת?`
        : null;
  if (!problem) return null;
  if (!body.attemptsLeft) return `${problem} ${VENUE_LOCKED_MESSAGE}`;
  return `${problem} ${body.attemptsLeft === 1 ? "אפשר לתקן עוד פעם אחת." : `אפשר לתקן עוד ${body.attemptsLeft} פעמים.`}`;
}

function groupTooSmallMessage(message: string): string | null {
  // GroupTooSmallError's text (#174), e.g. "Group g1 has 2 members; a
  // meeting needs at least 3."
  if (!/members; a meeting needs at least \d+\./.test(message)) return null;
  return "אי אפשר לפתוח פגישה בקבוצה עם פחות מ-3 חברים.";
}

export function NewMeeting({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [date, setDate] = useState("");
  const [part, setPart] = useState<TimeOfDayPart | "">("");
  const [venue, setVenue] = useState("");
  // #240: after three misses the server stops looking venues up; the field
  // locks and the meeting can still be opened without one.
  const [venueLocked, setVenueLocked] = useState(false);
  const [occasion, setOccasion] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function submit() {
    setSubmitState("submitting");
    setErrorMessage(null);

    const body: Record<string, string> = {};
    if (date) body.date = date;
    if (part) body.part = part;
    if (venue.trim() && !venueLocked) body.venue = venue.trim();
    if (occasion.trim()) body.occasion = occasion.trim();

    try {
      const res = await fetch(`/api/groups/${groupId}/meetings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.status === 401) {
        setSubmitState("signed-out");
        return;
      }
      if (res.status === 404) {
        setSubmitState("not-found");
        return;
      }
      if (!res.ok) {
        const responseBody = await res.json();
        const aboutVenue = venueMessage(responseBody);
        if (aboutVenue) {
          if (!responseBody.attemptsLeft) {
            setVenueLocked(true);
            setVenue("");
          }
          setErrorMessage(aboutVenue);
          setSubmitState("error");
          return;
        }
        const message =
          capReachedMessage(responseBody.error ?? "") ??
          groupTooSmallMessage(responseBody.error ?? "") ??
          KNOWN_ERRORS[responseBody.error] ??
          "לא הצלחנו לפתוח את הפגישה. נסה שוב.";
        setErrorMessage(message);
        setSubmitState("error");
        return;
      }

      router.push(`/groups/${groupId}`);
    } catch {
      setErrorMessage("לא הצלחנו לפתוח את הפגישה. נסה שוב.");
      setSubmitState("error");
    }
  }

  if (submitState === "signed-out") {
    return (
      <ScreenState kind="notice" signIn>
        התחבר כדי לפתוח פגישה.
      </ScreenState>
    );
  }

  if (submitState === "not-found") {
    return (
      <ScreenState kind="notice">
        הקבוצה הזו לא נמצאה, או שאתה לא חבר בה.
      </ScreenState>
    );
  }

  const submitting = submitState === "submitting";

  return (
    <div className="sl-page">
      <Link href={`/groups/${groupId}`} className="sl-sub self-start">
        &rsaquo; חזרה לקבוצה
      </Link>
      <h1 className="sl-sec">פגישה חדשה</h1>
      <p className="sl-sub">
        כל השדות אופציונליים — אפשר לפתוח פגישה בלי למלא כלום, וזה בסדר גמור.
      </p>

      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="sl-line">תאריך</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="sl-field"
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="sl-line">חלק מהיום</span>
          <div className="flex flex-wrap gap-2">
            {PARTS.map((option) => {
              const active = part === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() =>
                    setPart((current) =>
                      current === option.value ? "" : option.value
                    )
                  }
                  aria-pressed={active}
                  className={active ? "sl-chip on" : "sl-chip"}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="sl-line">מקום</span>
          <input
            type="text"
            value={venue}
            onChange={(e) => setVenue(e.target.value)}
            placeholder="למשל, בית קפה נורדאו"
            disabled={venueLocked}
            className="sl-field"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="sl-line">לרגל מה נפגשים (אופציונלי)</span>
          <input
            type="text"
            value={occasion}
            onChange={(e) => setOccasion(e.target.value)}
            placeholder="למשל, יום הולדת לנועה"
            className="sl-field"
          />
        </label>
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={submitting}
        className="sl-btn go"
      >
        {submitting ? "פותח…" : "פתח פגישה"}
      </button>

      {errorMessage && <p className="sl-note">{errorMessage}</p>}
    </div>
  );
}

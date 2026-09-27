"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type SubmitState = "idle" | "submitting" | "signed-out" | "not-found" | "error";

const KNOWN_ERRORS: Record<string, string> = {
  "Body must be JSON.": "משהו השתבש. נסה שוב.",
  "Invalid meeting.": "בדוק את הפרטים שמילאת ונסה שוב.",
};

function capReachedMessage(message: string): string | null {
  // OpenMeetingCapReachedError's text, e.g. "Group g1 already has 3 open meetings."
  if (!/already has \d+ open meetings\./.test(message)) return null;
  return "כבר יש 3 פגישות פתוחות בקבוצה. סגרו אחת כדי לפתוח חדשה.";
}

export function NewMeeting({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [venue, setVenue] = useState("");
  const [occasion, setOccasion] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function submit() {
    setSubmitState("submitting");
    setErrorMessage(null);

    const body: Record<string, string> = {};
    if (date) body.date = date;
    if (date && time) body.time = time;
    if (venue.trim()) body.venue = venue.trim();
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
        const message =
          capReachedMessage(responseBody.error ?? "") ??
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
    return <p className="sl-page sl-sub">התחבר כדי לפתוח פגישה.</p>;
  }

  if (submitState === "not-found") {
    return (
      <p className="sl-page sl-sub">הקבוצה הזו לא נמצאה, או שאתה לא חבר בה.</p>
    );
  }

  const submitting = submitState === "submitting";

  return (
    <div className="sl-page">
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
            onChange={(e) => {
              setDate(e.target.value);
              if (!e.target.value) setTime("");
            }}
            className="sl-field"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="sl-line">שעה {!date && "(בחר תאריך קודם)"}</span>
          <input
            type="time"
            value={time}
            disabled={!date}
            onChange={(e) => setTime(e.target.value)}
            className="sl-field"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="sl-line">מקום</span>
          <input
            type="text"
            value={venue}
            onChange={(e) => setVenue(e.target.value)}
            placeholder="למשל, בית קפה נורדאו"
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

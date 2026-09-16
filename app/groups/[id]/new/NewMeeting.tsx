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
    return <p className="p-6 text-sm text-zinc-500">התחבר כדי לפתוח פגישה.</p>;
  }

  if (submitState === "not-found") {
    return (
      <p className="p-6 text-sm text-zinc-500">
        הקבוצה הזו לא נמצאה, או שאתה לא חבר בה.
      </p>
    );
  }

  const submitting = submitState === "submitting";

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        פגישה חדשה
      </h1>
      <p className="text-sm text-zinc-500">
        כל השדות אופציונליים — אפשר לפתוח פגישה בלי למלא כלום, וזה בסדר גמור.
      </p>

      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-zinc-700 dark:text-zinc-300">
            תאריך
          </span>
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              if (!e.target.value) setTime("");
            }}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-black"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-zinc-700 dark:text-zinc-300">
            שעה {!date && "(בחר תאריך קודם)"}
          </span>
          <input
            type="time"
            value={time}
            disabled={!date}
            onChange={(e) => setTime(e.target.value)}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-zinc-700 dark:bg-black"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-zinc-700 dark:text-zinc-300">מקום</span>
          <input
            type="text"
            value={venue}
            onChange={(e) => setVenue(e.target.value)}
            placeholder="למשל, בית קפה נורדאו"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-black"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-zinc-700 dark:text-zinc-300">
            לרגל מה נפגשים (אופציונלי)
          </span>
          <input
            type="text"
            value={occasion}
            onChange={(e) => setOccasion(e.target.value)}
            placeholder="למשל, יום הולדת לנועה"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-black"
          />
        </label>
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={submitting}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-black"
      >
        {submitting ? "פותח…" : "פתח פגישה"}
      </button>

      {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}
    </div>
  );
}

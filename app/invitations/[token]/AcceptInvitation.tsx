"use client";

import { useState } from "react";
import Link from "next/link";

type State =
  | { status: "idle" | "accepting" }
  | { status: "success"; groupId: string }
  | { status: "signed-out" }
  | { status: "error"; message: string };

const KNOWN_ERRORS: Record<string, string> = {
  "Invitation not found.": "ההזמנה הזו לא נמצאה.",
  "This invitation has already been accepted.": "ההזמנה הזו כבר אושרה.",
  "This invitation was sent to a different address.":
    "ההזמנה הזו נשלחה לכתובת אימייל אחרת מזו שאיתה התחברת.",
};

export function AcceptInvitation({ token }: { token: string }) {
  const [state, setState] = useState<State>({ status: "idle" });

  async function accept() {
    setState({ status: "accepting" });
    try {
      const res = await fetch(`/api/invitations/${token}/accept`, {
        method: "POST",
      });
      if (res.status === 401) {
        setState({ status: "signed-out" });
        return;
      }
      const body = await res.json();
      if (!res.ok) {
        setState({
          status: "error",
          message: KNOWN_ERRORS[body.error] ?? "משהו השתבש. נסה שוב.",
        });
        return;
      }
      setState({ status: "success", groupId: body.groupId });
    } catch {
      setState({ status: "error", message: "משהו השתבש. נסה שוב." });
    }
  }

  if (state.status === "success") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-zinc-900 dark:text-zinc-50">
          הצטרפת לקבוצה!
        </p>
        <Link
          href={`/groups/${state.groupId}`}
          className="text-sm font-medium underline"
        >
          מעבר לקבוצה
        </Link>
      </div>
    );
  }

  if (state.status === "signed-out") {
    return (
      <p className="p-6 text-center text-sm text-zinc-500">
        התחבר עם Google כדי להצטרף לקבוצה.
      </p>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm text-zinc-900 dark:text-zinc-50">
        הוזמנת להצטרף לקבוצה.
      </p>
      <button
        type="button"
        onClick={accept}
        disabled={state.status === "accepting"}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-black"
      >
        {state.status === "accepting" ? "מצטרף…" : "הצטרף לקבוצה"}
      </button>
      {state.status === "error" && (
        <p className="text-sm text-red-600">{state.message}</p>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { PreferenceGame } from "./PreferenceGame";

import type { SoftPreferences } from "@/lib/types";

type SaveState = "idle" | "saving" | "saved" | "signed-out" | "error";

const BODY_FONT = "var(--font-work-sans)";

/**
 * The this-or-that game never saved anywhere — `onComplete` existed but
 * nothing called it. This is the missing other half: PUT the answers to B3's
 * `/api/preferences` the moment the game finishes, under the game's own
 * `PreferenceGame`'s optional `doneFooter` so the closing screen can show
 * whether it actually worked.
 */
export function PreferenceGameContainer() {
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lastAnswers, setLastAnswers] = useState<SoftPreferences | null>(null);

  async function save(preferences: SoftPreferences) {
    setLastAnswers(preferences);
    setSaveState("saving");
    try {
      const res = await fetch("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ softPreferences: preferences }),
      });
      if (res.status === 401) {
        setSaveState("signed-out");
        return;
      }
      if (!res.ok) throw new Error(`PUT /api/preferences: ${res.status}`);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  function retry() {
    if (lastAnswers) save(lastAnswers);
  }

  return (
    <PreferenceGame
      onComplete={save}
      doneFooter={
        <div
          style={{ fontFamily: BODY_FONT }}
          className="flex flex-col items-center gap-1 text-sm"
        >
          {saveState === "saving" && (
            <span style={{ color: "rgba(20,22,28,0.65)" }}>שומר…</span>
          )}
          {saveState === "saved" && (
            <span style={{ color: "#1C4E4A" }}>נשמר.</span>
          )}
          {saveState === "signed-out" && (
            <span style={{ color: "rgba(20,22,28,0.65)" }}>
              התחבר כדי לשמור את התשובות שלך.
            </span>
          )}
          {saveState === "error" && (
            <div className="flex items-center gap-2">
              <span style={{ color: "#8a2e2e" }}>לא הצלחנו לשמור.</span>
              <button
                type="button"
                onClick={retry}
                className="cursor-pointer underline underline-offset-2"
                style={{ color: "#8a2e2e" }}
              >
                נסה שוב
              </button>
            </div>
          )}
        </div>
      }
    />
  );
}

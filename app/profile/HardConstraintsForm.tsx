"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type {
  HardConstraints,
  LocalWeekday,
  LocalWindow,
  SoftPreferences,
} from "@/lib/types";
import { softPreferenceSummary } from "@/app/onboarding/preferences/PreferenceGame";
import { WEEKDAY_LABELS } from "@/lib/format/hebrew-labels";
import { ScreenState } from "@/app/_components/ScreenState";

const DIETARY_PRESETS = ["כשר", "צמחוני", "טבעוני", "חלאל"];
const ALLERGY_PRESETS = ["אגוזים", "פירות ים", "מוצרי חלב", "גלוטן"];
const WEEKDAYS: LocalWeekday[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const EMPTY: HardConstraints = { dietary: [], allergies: [], unavailable: [] };

type LoadState = "loading" | "ready" | "signed-out" | "error";
type SaveState = "idle" | "saving" | "saved" | "error";

export function HardConstraintsForm() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [constraints, setConstraints] = useState<HardConstraints>(EMPTY);
  const [softPreferences, setSoftPreferences] = useState<
    Partial<SoftPreferences>
  >({});

  useEffect(() => {
    let cancelled = false;

    fetch("/api/preferences")
      .then((res) => {
        if (res.status === 401) {
          if (!cancelled) setLoadState("signed-out");
          return null;
        }
        if (!res.ok) throw new Error(`GET /api/preferences: ${res.status}`);
        return res.json();
      })
      .then((profile) => {
        if (cancelled || !profile) return;
        setConstraints({ ...EMPTY, ...profile.hardConstraints });
        setSoftPreferences(profile.softPreferences ?? {});
        setLoadState("ready");
      })
      .catch(() => {
        if (!cancelled) setLoadState("error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setSaveState("saving");
    try {
      const res = await fetch("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hardConstraints: constraints }),
      });
      if (!res.ok) throw new Error(`PUT /api/preferences: ${res.status}`);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  if (loadState === "loading") {
    return <ScreenState kind="loading">טוען את הפרופיל שלך…</ScreenState>;
  }

  if (loadState === "signed-out") {
    return (
      <ScreenState kind="notice" signIn>
        התחבר כדי להגדיר את האילוצים שלך.
      </ScreenState>
    );
  }

  if (loadState === "error") {
    return (
      <ScreenState kind="error">
        לא הצלחנו לטעון את הפרופיל. נסה לרענן את הדף.
      </ScreenState>
    );
  }

  return (
    <div className="sl-page">
      {/* Read-only: the game is the one place these are set, and nowhere
          else showed what it saved. */}
      <section className="flex flex-col gap-1">
        <h2 className="sl-sec">ההעדפות שלך מהמשחק</h2>
        <p>{softPreferenceSummary(softPreferences).join(" · ")}</p>
        <Link
          href="/onboarding/preferences"
          className="sl-sub self-start font-bold underline"
        >
          לשנות
        </Link>
      </section>

      <TagSection
        title="דרישות תזונה"
        presets={DIETARY_PRESETS}
        values={constraints.dietary}
        onChange={(dietary) => setConstraints((c) => ({ ...c, dietary }))}
      />

      <TagSection
        title="אלרגיות"
        presets={ALLERGY_PRESETS}
        values={constraints.allergies}
        onChange={(allergies) => setConstraints((c) => ({ ...c, allergies }))}
      />

      <UnavailableSection
        windows={constraints.unavailable}
        onChange={(unavailable) =>
          setConstraints((c) => ({ ...c, unavailable }))
        }
      />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saveState === "saving"}
          className="sl-btn go"
        >
          {saveState === "saving" ? "שומר…" : "שמור"}
        </button>
        {saveState === "saved" && <span className="sl-note">נשמר.</span>}
        {saveState === "error" && (
          <span className="sl-note">לא הצלחנו לשמור. נסה שוב.</span>
        )}
      </div>
    </div>
  );
}

function TagSection({
  title,
  presets,
  values,
  onChange,
}: {
  title: string;
  presets: string[];
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const [customInput, setCustomInput] = useState("");
  const allOptions = [
    ...presets,
    ...values.filter((v) => !presets.includes(v)),
  ];

  function toggle(option: string) {
    onChange(
      values.includes(option)
        ? values.filter((v) => v !== option)
        : [...values, option]
    );
  }

  function addCustom() {
    const trimmed = customInput.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setCustomInput("");
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="sl-sec">{title}</h2>
      <div className="flex flex-wrap gap-2">
        {allOptions.map((option) => {
          const active = values.includes(option);
          return (
            <button
              key={option}
              type="button"
              onClick={() => toggle(option)}
              aria-pressed={active}
              className={active ? "sl-chip on" : "sl-chip"}
            >
              {option}
            </button>
          );
        })}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addCustom();
            }
          }}
          placeholder="הוסף עוד"
          className="sl-field flex-1"
        />
        <button type="button" onClick={addCustom} className="sl-btn">
          הוסף
        </button>
      </div>
    </section>
  );
}

function UnavailableSection({
  windows,
  onChange,
}: {
  windows: LocalWindow[];
  onChange: (next: LocalWindow[]) => void;
}) {
  const [weekdays, setWeekdays] = useState<LocalWeekday[]>([]);
  const [from, setFrom] = useState("18:00");
  const [to, setTo] = useState("21:00");

  function toggleDay(day: LocalWeekday) {
    setWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  }

  function addWindow() {
    onChange([...windows, { weekdays, from, to }]);
    setWeekdays([]);
  }

  function removeWindow(index: number) {
    onChange(windows.filter((_, i) => i !== index));
  }

  function describeDays(days: LocalWeekday[]): string {
    return days.length
      ? days.map((d) => WEEKDAY_LABELS[d]).join(", ")
      : "כל יום";
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="sl-sec">שעות קבועות שאינך זמין/ה</h2>

      {windows.map((w, i) => (
        <div key={i} className="sl-card justify-between">
          <span>
            {describeDays(w.weekdays)} · {w.from}–{w.to}
          </span>
          <button
            type="button"
            onClick={() => removeWindow(i)}
            className="sl-sub"
          >
            הסר
          </button>
        </div>
      ))}

      <div className="flex flex-wrap gap-1.5">
        {WEEKDAYS.map((day) => {
          const active = weekdays.includes(day);
          return (
            <button
              key={day}
              type="button"
              onClick={() => toggleDay(day)}
              aria-pressed={active}
              className={active ? "sl-chip on" : "sl-chip"}
            >
              {WEEKDAY_LABELS[day]}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="time"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="sl-field w-auto"
        />
        <span className="sl-sub">עד</span>
        <input
          type="time"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="sl-field w-auto"
        />
        <button type="button" onClick={addWindow} className="sl-btn">
          הוסף
        </button>
      </div>
    </section>
  );
}

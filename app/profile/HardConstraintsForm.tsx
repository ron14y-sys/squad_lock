"use client";

import { useEffect, useState } from "react";
import type { HardConstraints, LocalWeekday, LocalWindow } from "@/lib/types";
import { WEEKDAY_LABELS } from "@/lib/format/hebrew-labels";

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
    return <p className="p-6 text-sm text-zinc-500">טוען את הפרופיל שלך…</p>;
  }

  if (loadState === "signed-out") {
    return (
      <p className="p-6 text-sm text-zinc-500">
        התחבר כדי להגדיר את האילוצים שלך.
      </p>
    );
  }

  if (loadState === "error") {
    return (
      <p className="p-6 text-sm text-red-600">
        לא הצלחנו לטעון את הפרופיל. נסה לרענן את הדף.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-8 p-6">
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
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-black"
        >
          {saveState === "saving" ? "שומר…" : "שמור"}
        </button>
        {saveState === "saved" && (
          <span className="text-sm text-emerald-600">נשמר.</span>
        )}
        {saveState === "error" && (
          <span className="text-sm text-red-600">
            לא הצלחנו לשמור. נסה שוב.
          </span>
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
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        {title}
      </h2>
      <div className="flex flex-wrap gap-2">
        {allOptions.map((option) => {
          const active = values.includes(option);
          return (
            <button
              key={option}
              type="button"
              onClick={() => toggle(option)}
              aria-pressed={active}
              className={
                active
                  ? "rounded-full border border-zinc-900 bg-zinc-900 px-3 py-1.5 text-sm text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-black"
                  : "rounded-full border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
              }
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
          className="flex-1 rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-black"
        />
        <button
          type="button"
          onClick={addCustom}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
        >
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
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        שעות קבועות שאינך זמין/ה
      </h2>

      {windows.map((w, i) => (
        <div
          key={i}
          className="flex items-center justify-between rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700"
        >
          <span>
            {describeDays(w.weekdays)} · {w.from}–{w.to}
          </span>
          <button
            type="button"
            onClick={() => removeWindow(i)}
            className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50"
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
              className={
                active
                  ? "rounded-md border border-zinc-900 bg-zinc-900 px-2.5 py-1 text-xs text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-black"
                  : "rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
              }
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
          className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-black"
        />
        <span className="text-sm text-zinc-500">עד</span>
        <input
          type="time"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-black"
        />
        <button
          type="button"
          onClick={addWindow}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
        >
          הוסף
        </button>
      </div>
    </section>
  );
}

"use client";

import { useEffect, useState } from "react";
import type {
  Kilometres,
  LocalWeekday,
  MobilityMode,
  RecurringMobilityRule,
} from "@/lib/types";
import {
  MOBILITY_MODE_LABELS,
  WEEKDAY_LABELS,
} from "@/lib/format/hebrew-labels";

/**
 * Labels the user sees; kilometres are what get stored and unit-tested
 * (spec §5.1 — "a 1-5 scale is an invisible mapping table nobody remembers
 * by week 6"). Illustrative steps, not a measured product decision.
 */
const TOLERANCE_OPTIONS: { label: string; km: Kilometres }[] = [
  { label: "ברגל", km: 1.5 },
  { label: "בשכונה", km: 3 },
  { label: "חצי מהעיר", km: 8 },
  { label: "בכל מקום", km: 20 },
];

const WEEKDAYS: LocalWeekday[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const MOBILITY_MODES: MobilityMode[] = ["car", "transit", "walk"];

type LoadState = "loading" | "ready" | "signed-out" | "error";
type SaveState = "idle" | "saving" | "saved" | "error";

export function LocationForm() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [homeNeighbourhood, setHomeNeighbourhood] = useState("");
  const [toleranceKm, setToleranceKm] = useState<Kilometres>(
    TOLERANCE_OPTIONS[1].km
  );
  const [rules, setRules] = useState<RecurringMobilityRule[]>([]);

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
        setHomeNeighbourhood(profile.homeNeighbourhood ?? "");
        setToleranceKm(profile.toleranceKm ?? TOLERANCE_OPTIONS[1].km);
        setRules(profile.recurringMobilityRules ?? []);
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
        body: JSON.stringify({
          homeNeighbourhood: homeNeighbourhood.trim(),
          toleranceKm,
          recurringMobilityRules: rules,
        }),
      });
      if (!res.ok) throw new Error(`PUT /api/preferences: ${res.status}`);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  if (loadState === "loading") {
    return <p className="sl-page sl-sub">טוען את הפרופיל שלך…</p>;
  }

  if (loadState === "signed-out") {
    return (
      <p className="sl-page sl-sub">
        התחבר כדי להגדיר את המיקום שלך ומרחק הנסיעה.
      </p>
    );
  }

  if (loadState === "error") {
    return (
      <p className="sl-page sl-sub">
        לא הצלחנו לטעון את הפרופיל. נסה לרענן את הדף.
      </p>
    );
  }

  return (
    <div className="sl-page">
      <section className="flex flex-col gap-2">
        <h2 className="sl-sec">שכונת מגורים</h2>
        <input
          type="text"
          value={homeNeighbourhood}
          onChange={(e) => setHomeNeighbourhood(e.target.value)}
          placeholder="לדוגמה: רוטשילד, תל אביב"
          className="sl-field"
        />
        <p className="sl-sub">
          אנחנו שומרים רק את האזור שלך, אף פעם לא כתובת מדויקת — זה גלוי לכל מי
          שנמצא איתך בקבוצות.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="sl-sec">עד כמה אתה מוכן לנסוע</h2>
        <div className="flex flex-wrap gap-2">
          {TOLERANCE_OPTIONS.map((option) => {
            const active = option.km === toleranceKm;
            return (
              <button
                key={option.label}
                type="button"
                onClick={() => setToleranceKm(option.km)}
                aria-pressed={active}
                className={active ? "sl-chip on" : "sl-chip"}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <p className="sl-sub">נשמר כ-{toleranceKm} ק״מ.</p>
      </section>

      <RecurringRulesSection rules={rules} onChange={setRules} />

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

function RecurringRulesSection({
  rules,
  onChange,
}: {
  rules: RecurringMobilityRule[];
  onChange: (next: RecurringMobilityRule[]) => void;
}) {
  const [kind, setKind] =
    useState<RecurringMobilityRule["kind"]>("mode_unavailable");
  const [weekdays, setWeekdays] = useState<LocalWeekday[]>([]);
  const [mode, setMode] = useState<MobilityMode>("car");
  const [originLabel, setOriginLabel] = useState("");

  function toggleDay(day: LocalWeekday) {
    setWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  }

  function addRule() {
    if (weekdays.length === 0) return;
    const rule: RecurringMobilityRule =
      kind === "mode_unavailable"
        ? { kind, weekdays, mode }
        : { kind, weekdays, originLabel: originLabel.trim() };

    if (rule.kind === "origin_override" && !rule.originLabel) return;

    onChange([...rules, rule]);
    setWeekdays([]);
    setOriginLabel("");
  }

  function removeRule(index: number) {
    onChange(rules.filter((_, i) => i !== index));
  }

  function describe(rule: RecurringMobilityRule): string {
    const days = rule.weekdays.map((d) => WEEKDAY_LABELS[d]).join(", ");
    return rule.kind === "mode_unavailable"
      ? `${days} · בלי ${MOBILITY_MODE_LABELS[rule.mode]}`
      : `${days} · מגיע/ה מ${rule.originLabel}`;
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="sl-sec">כללי ניידות קבועים</h2>

      {rules.map((rule, i) => (
        <div key={i} className="sl-card justify-between">
          <span>{describe(rule)}</span>
          <button
            type="button"
            onClick={() => removeRule(i)}
            className="sl-sub"
          >
            הסר
          </button>
        </div>
      ))}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setKind("mode_unavailable")}
          aria-pressed={kind === "mode_unavailable"}
          className={kind === "mode_unavailable" ? "sl-chip on" : "sl-chip"}
        >
          אין אמצעי תחבורה מסוים בימים...
        </button>
        <button
          type="button"
          onClick={() => setKind("origin_override")}
          aria-pressed={kind === "origin_override"}
          className={kind === "origin_override" ? "sl-chip on" : "sl-chip"}
        >
          אני מגיע/ה ממקום אחר בימים...
        </button>
      </div>

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

      {kind === "mode_unavailable" ? (
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as MobilityMode)}
          className="sl-field w-fit"
        >
          {MOBILITY_MODES.map((m) => (
            <option key={m} value={m}>
              בלי {MOBILITY_MODE_LABELS[m]}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          value={originLabel}
          onChange={(e) => setOriginLabel(e.target.value)}
          placeholder="לדוגמה: עבודה"
          className="sl-field"
        />
      )}

      <button type="button" onClick={addRule} className="sl-btn w-fit">
        הוסף
      </button>
    </section>
  );
}

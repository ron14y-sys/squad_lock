"use client";

import { useEffect, useState } from "react";
import type {
  Kilometres,
  LocalWeekday,
  MobilityMode,
  RecurringMobilityRule,
} from "@/lib/types";
import {
  NEIGHBOURHOODS,
  NEIGHBOURHOOD_GROUPS,
  findNeighbourhoodById,
  findNeighbourhoodByLabel,
} from "@/lib/geo/neighbourhoods";
import { TOLERANCE_OPTIONS } from "@/lib/preferences/tolerance";
import {
  MOBILITY_MODE_LABELS,
  WEEKDAY_LABELS,
} from "@/lib/format/hebrew-labels";
import { ScreenState } from "@/app/_components/ScreenState";

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
  // The picked list entry's id, or "" for nothing picked yet.
  const [homeId, setHomeId] = useState("");
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
        // Free text from before the picker existed matches nothing and has to
        // be re-picked — its coordinates were never saved anyway (#132).
        setHomeId(
          findNeighbourhoodByLabel(profile.homeNeighbourhood)?.id ?? ""
        );
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
    const home = findNeighbourhoodById(homeId);
    if (!home) return;
    setSaveState("saving");
    try {
      const res = await fetch("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          homeNeighbourhood: home.label,
          home: home.centre,
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
    return <ScreenState kind="loading">טוען את הפרופיל שלך…</ScreenState>;
  }

  if (loadState === "signed-out") {
    return (
      <ScreenState kind="notice" signIn>
        התחבר כדי להגדיר את המיקום שלך ומרחק הנסיעה.
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
      <section className="flex flex-col gap-2">
        <h2 className="sl-sec">שכונת מגורים</h2>
        <select
          value={homeId}
          onChange={(e) => setHomeId(e.target.value)}
          aria-label="שכונת מגורים"
          className="sl-field"
        >
          <option value="" disabled>
            בחר אזור מהרשימה
          </option>
          {NEIGHBOURHOOD_GROUPS.map((group) => (
            <optgroup key={group} label={group}>
              {NEIGHBOURHOODS.filter((n) => n.group === group).map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
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
          disabled={saveState === "saving" || homeId === ""}
          className="sl-btn go"
        >
          {saveState === "saving" ? "שומר…" : "שמור"}
        </button>
        {homeId === "" && (
          <span className="sl-note">בחר אזור מגורים כדי לשמור.</span>
        )}
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

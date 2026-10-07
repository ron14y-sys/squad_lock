"use client";

import { useState, type ReactNode } from "react";
import type { SoftPreferences } from "@/lib/types";
import {
  BUDGET_LABELS,
  CUISINES,
  CUISINE_LABELS,
  VENUE_KINDS,
  VENUE_KIND_LABELS,
} from "@/lib/preferences/vocabulary";

/**
 * A single tap picks one of two values — budget's shape, unchanged since
 * before #217.
 */
type ChoiceQuestion<K extends keyof SoftPreferences = keyof SoftPreferences> = {
  kind: "choice";
  key: K;
  prompt: string;
  left: { label: string; value: SoftPreferences[K] };
  right: { label: string; value: SoftPreferences[K] };
};

/**
 * #218: kind of place and cuisine are each several possible answers, not
 * one of two — a left/right card cannot ask either. Chips the person
 * toggles, plus an explicit "continue" to move on (there is no single tap
 * that completes a multi-select the way picking a card does).
 */
type MultiQuestion<
  K extends "venueKinds" | "cuisines" = "venueKinds" | "cuisines",
> = {
  kind: "multi";
  key: K;
  prompt: string;
  options: { label: string; value: NonNullable<SoftPreferences[K]>[number] }[];
};

type Question = ChoiceQuestion | MultiQuestion;

function choiceQuestion<K extends keyof SoftPreferences>(
  q: Omit<ChoiceQuestion<K>, "kind">
): Question {
  return { kind: "choice", ...q } as Question;
}

function multiQuestion<K extends "venueKinds" | "cuisines">(
  q: Omit<MultiQuestion<K>, "kind">
): Question {
  return { kind: "multi", ...q } as Question;
}

// #217 dropped noise, activity style and "familiar or adventurous" from the
// vocabulary; the server no longer stores them, so they are no longer asked.
const QUESTIONS: Question[] = [
  choiceQuestion({
    key: "budget",
    prompt: "תקציב סטודנטים או פינוק חד-פעמי?",
    left: { label: BUDGET_LABELS.modest, value: "modest" },
    right: { label: BUDGET_LABELS.splurge, value: "splurge" },
  }),
  multiQuestion({
    key: "venueKinds",
    prompt: "אילו סוגי מקומות הכי מתאימים לך?",
    options: VENUE_KINDS.map((value) => ({
      value,
      label: VENUE_KIND_LABELS[value],
    })),
  }),
  multiQuestion({
    key: "cuisines",
    prompt: "איזה אוכל הכי מדבר אליך?",
    options: CUISINES.map((value) => ({
      value,
      label: CUISINE_LABELS[value],
    })),
  }),
];

/**
 * One line per question, in question order: the chosen side's label (or
 * every chosen chip, joined), or "לא משנה לי" for a field with no answer.
 * Shared by the closing screen and the profile page, so both say the same
 * thing about the same row.
 */
export function softPreferenceSummary(
  preferences: Partial<SoftPreferences>
): string[] {
  return QUESTIONS.map((q) => {
    if (q.kind === "choice") {
      const value = preferences[q.key];
      if (value === q.left.value) return q.left.label;
      if (value === q.right.value) return q.right.label;
      return "לא משנה לי";
    }

    const values = preferences[q.key] as string[] | undefined;
    if (!values || values.length === 0) return "לא משנה לי";
    return q.options
      .filter((option) => values.includes(option.value))
      .map((option) => option.label)
      .join(" / ");
  });
}

const CARD_FONT = "var(--font-unbounded)";
const BODY_FONT = "var(--font-work-sans)";

/**
 * One multi-select step. Its own local `selected` state, reset by the
 * parent remounting this with a new `key` per question — the idiomatic
 * way to start fresh for each question without a manual effect — seeded
 * from whatever was already chosen (profile, or this session's earlier
 * pass through the game), per #203.
 */
function MultiSelectStep({
  question,
  initial,
  onContinue,
}: {
  question: MultiQuestion;
  initial: string[] | undefined;
  onContinue: (values: string[] | undefined) => void;
}) {
  const [selected, setSelected] = useState<string[]>(initial ?? []);

  function toggle(value: string) {
    setSelected((current) =>
      current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value]
    );
  }

  return (
    <>
      <div className="flex flex-wrap justify-center gap-2.5">
        {question.options.map((option) => {
          const active = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => toggle(option.value)}
              aria-pressed={active}
              className="cursor-pointer rounded-full border-[3px] px-4 py-2 text-[15px] font-bold transition-transform duration-150 ease-out active:scale-95 motion-reduce:transition-none"
              style={{
                fontFamily: CARD_FONT,
                borderColor: "#14161C",
                background: active ? "#1C4E4A" : "#FFEDE3",
                color: active ? "#FFEDE3" : "#14161C",
                boxShadow: active ? "3px 4px 0 rgba(20,22,28,0.9)" : "none",
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => onContinue(selected.length > 0 ? selected : undefined)}
        className="mt-9 cursor-pointer self-center rounded-full px-9 py-3 text-[17px] font-black transition-transform duration-150 ease-out active:scale-95 motion-reduce:transition-none"
        style={{
          fontFamily: CARD_FONT,
          background: "#14161C",
          color: "#FFEDE3",
        }}
      >
        המשך
      </button>
    </>
  );
}

export function PreferenceGame({
  onComplete,
  doneFooter,
  initial = {},
}: {
  onComplete?: (preferences: SoftPreferences) => void;
  /** Rendered under the closing screen — e.g. a save-status line. */
  doneFooter?: ReactNode;
  /**
   * The answers already saved. The game starts from them, so replaying it
   * changes only what is answered differently — the save replaces the
   * whole set, and starting from `{}` silently dropped every earlier answer.
   */
  initial?: Partial<SoftPreferences>;
}) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Partial<SoftPreferences>>(initial);

  const done = index >= QUESTIONS.length;

  function advance(next: Partial<SoftPreferences>) {
    setAnswers(next);
    if (index + 1 >= QUESTIONS.length) {
      onComplete?.(next as SoftPreferences);
    }
    setIndex(index + 1);
  }

  function choose(
    q: ChoiceQuestion,
    value: SoftPreferences[keyof SoftPreferences]
  ) {
    advance({ ...answers, [q.key]: value });
  }

  function continueMulti(q: MultiQuestion, values: string[] | undefined) {
    advance({ ...answers, [q.key]: values });
  }

  // Forcing an answer manufactures an opinion nobody holds (#86) — declining
  // stores nothing for this field rather than a default, so `answers` is
  // simply left as it was. That includes an answer saved earlier: skipping
  // keeps it, and the button says so.
  function skip() {
    advance(answers);
  }

  if (done) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center"
        style={{ backgroundColor: "#FFB199" }}
      >
        <h1
          style={{ fontFamily: CARD_FONT, color: "#14161C" }}
          className="text-3xl font-black tracking-tight"
        >
          זה אתה.
        </h1>
        <p
          style={{ fontFamily: BODY_FONT, color: "rgba(20,22,28,0.65)" }}
          className="max-w-xs text-base"
        >
          נשתמש בזה כדי למצוא מקומות שכל הקבוצה שלך באמת תרצה ללכת אליהם.
        </p>
        <p
          style={{ fontFamily: BODY_FONT, color: "#14161C" }}
          className="max-w-xs text-base font-semibold"
        >
          {softPreferenceSummary(answers).join(" · ")}
        </p>
        {doneFooter}
      </div>
    );
  }

  const q = QUESTIONS[index];
  const saved = initial[q.key];

  return (
    <div
      className="flex flex-1 flex-col overflow-hidden"
      style={{ backgroundColor: "#FFB199" }}
    >
      <div
        role="progressbar"
        aria-valuenow={index + 1}
        aria-valuemin={1}
        aria-valuemax={QUESTIONS.length}
        className="flex justify-center gap-2 pt-7 pb-2"
      >
        {QUESTIONS.map((question, i) => (
          <div
            key={question.key}
            className="h-1.5 w-7 rounded-full"
            style={{
              backgroundColor: i <= index ? "#14161C" : "rgba(20,22,28,0.25)",
            }}
          />
        ))}
      </div>
      <p
        style={{ fontFamily: BODY_FONT, color: "rgba(20,22,28,0.6)" }}
        className="text-center text-[13px] font-semibold tracking-wide"
      >
        שאלה {index + 1} מתוך {QUESTIONS.length}
      </p>

      <div className="flex flex-1 flex-col justify-center px-7">
        <h1
          style={{ fontFamily: CARD_FONT, color: "#14161C" }}
          className="mb-10 text-[34px] leading-[1.08] font-black tracking-tight text-balance"
        >
          {q.prompt}
        </h1>

        {q.kind === "choice" ? (
          <div
            className="flex justify-center gap-5"
            style={{ perspective: "900px" }}
          >
            <button
              type="button"
              onClick={() => choose(q, q.left.value)}
              aria-pressed={saved === q.left.value}
              className="w-[150px] cursor-pointer rounded-[18px] border-[3px] p-6 text-right transition-transform duration-150 ease-out active:scale-95 motion-reduce:transition-none"
              style={{
                transform: "rotateY(14deg) rotateZ(-2deg)",
                transformStyle: "preserve-3d",
                background: "#1C4E4A",
                borderColor: "#14161C",
                boxShadow: "14px 18px 0 rgba(20,22,28,0.9)",
              }}
            >
              <span
                style={{ fontFamily: CARD_FONT, color: "#FFEDE3" }}
                className="text-[19px] leading-tight font-bold"
              >
                {q.left.label}
              </span>
              {saved === q.left.value && (
                <span
                  aria-hidden="true"
                  style={{ fontFamily: BODY_FONT, color: "#FFEDE3" }}
                  className="mt-2 block text-[12px] font-semibold opacity-80"
                >
                  הבחירה שלך עד עכשיו
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => choose(q, q.right.value)}
              aria-pressed={saved === q.right.value}
              className="mt-5 w-[150px] cursor-pointer rounded-[18px] border-[3px] p-6 text-right transition-transform duration-150 ease-out active:scale-95 motion-reduce:transition-none"
              style={{
                transform: "rotateY(-14deg) rotateZ(2deg)",
                transformStyle: "preserve-3d",
                background: "#FFEDE3",
                borderColor: "#14161C",
                boxShadow: "-14px 18px 0 rgba(20,22,28,0.9)",
              }}
            >
              <span
                style={{ fontFamily: CARD_FONT, color: "#14161C" }}
                className="text-[19px] leading-tight font-bold"
              >
                {q.right.label}
              </span>
              {saved === q.right.value && (
                <span
                  aria-hidden="true"
                  style={{ fontFamily: BODY_FONT, color: "#14161C" }}
                  className="mt-2 block text-[12px] font-semibold opacity-80"
                >
                  הבחירה שלך עד עכשיו
                </span>
              )}
            </button>
          </div>
        ) : (
          <MultiSelectStep
            key={q.key}
            question={q}
            initial={saved as string[] | undefined}
            onContinue={(values) => continueMulti(q, values)}
          />
        )}
      </div>

      <div className="flex flex-col items-center gap-2 px-7 pb-10">
        <p
          style={{ fontFamily: BODY_FONT, color: "rgba(20,22,28,0.55)" }}
          className="text-center text-[13px]"
        >
          {q.kind === "choice"
            ? `לחצו על כרטיס — ${QUESTIONS.length} שאלות, פחות מדקה.`
            : "אפשר לבחור כמה שרוצים."}
        </p>
        <button
          type="button"
          onClick={skip}
          style={{ fontFamily: BODY_FONT, color: "rgba(20,22,28,0.55)" }}
          className="cursor-pointer text-[13px] underline underline-offset-2"
        >
          {saved === undefined ? "זה לא משנה לי — דלג" : "דלג — השאר כמו שהיה"}
        </button>
      </div>
    </div>
  );
}

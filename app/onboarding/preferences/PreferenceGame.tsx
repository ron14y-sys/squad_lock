"use client";

import { useState } from "react";
import type { SoftPreferences } from "@/lib/types";

type Question<K extends keyof SoftPreferences = keyof SoftPreferences> = {
  key: K;
  prompt: string;
  left: { label: string; value: SoftPreferences[K] };
  right: { label: string; value: SoftPreferences[K] };
};

function question<K extends keyof SoftPreferences>(q: Question<K>): Question {
  return q as Question;
}

const QUESTIONS: Question[] = [
  question({
    key: "noiseLevel",
    prompt: "בר רועש או בית קפה שקט?",
    left: { label: "בר רועש", value: "lively" },
    right: { label: "בית קפה שקט", value: "quiet" },
  }),
  question({
    key: "activityStyle",
    prompt: "טיול בטבע או סיור במוזיאון?",
    left: { label: "טיול בטבע", value: "outdoorsy" },
    right: { label: "סיור במוזיאון", value: "cultural" },
  }),
  question({
    key: "budget",
    prompt: "תקציב סטודנטים או פינוק חד-פעמי?",
    left: { label: "תקציב סטודנטים", value: "modest" },
    right: { label: "פינוק חד-פעמי", value: "splurge" },
  }),
  question({
    key: "cuisine",
    prompt: "אוכל מוכר ובטוח או משהו הרפתקני?",
    left: { label: "אוכל מוכר", value: "familiar" },
    right: { label: "משהו הרפתקני", value: "adventurous" },
  }),
];

const CARD_FONT = "var(--font-unbounded)";
const BODY_FONT = "var(--font-work-sans)";

export function PreferenceGame({
  onComplete,
}: {
  onComplete?: (preferences: SoftPreferences) => void;
}) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Partial<SoftPreferences>>({});

  const done = index >= QUESTIONS.length;

  function choose(q: Question, value: SoftPreferences[keyof SoftPreferences]) {
    const next = { ...answers, [q.key]: value };
    setAnswers(next);
    if (index + 1 >= QUESTIONS.length) {
      onComplete?.(next as SoftPreferences);
    }
    setIndex(index + 1);
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
      </div>
    );
  }

  const q = QUESTIONS[index];

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

        <div
          className="flex justify-center gap-5"
          style={{ perspective: "900px" }}
        >
          <button
            type="button"
            onClick={() => choose(q, q.left.value)}
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
          </button>

          <button
            type="button"
            onClick={() => choose(q, q.right.value)}
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
          </button>
        </div>
      </div>

      <p
        style={{ fontFamily: BODY_FONT, color: "rgba(20,22,28,0.55)" }}
        className="px-7 pb-10 text-center text-[13px]"
      >
        לחצו על כרטיס — {QUESTIONS.length} שאלות, פחות מדקה.
      </p>
    </div>
  );
}

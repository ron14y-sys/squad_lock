// Hebrew display labels for values whose *stored* form must stay the
// English literal the backend schema expects (lib/preferences/schema.ts).
// Translating the label here never touches the value sent to the API.

import type { LocalWeekday, MobilityMode } from "@/lib/types";
import type { UnverifiedFact } from "@/lib/matching/constraints";

export const WEEKDAY_LABELS: Record<LocalWeekday, string> = {
  sunday: "א׳",
  monday: "ב׳",
  tuesday: "ג׳",
  wednesday: "ד׳",
  thursday: "ה׳",
  friday: "ו׳",
  saturday: "ש׳",
};

export const MOBILITY_MODE_LABELS: Record<MobilityMode, string> = {
  car: "רכב",
  transit: "תחבורה ציבורית",
  walk: "הליכה",
};

/**
 * The tags a venue can fail to be verified against. Free text on both sides
 * (`lib/types/profile.ts` keeps the vocabulary open), so an unknown tag is
 * shown as it was written rather than dropped or guessed at.
 */
const DIETARY_TAG_LABELS: Record<string, string> = {
  kosher: "כשרות",
  "vegan-option-required": "אפשרות טבעונית",
  shellfish: "פירות ים",
  gluten: "גלוטן",
  nuts: "אגוזים",
};

/**
 * "לא הצלחנו לאמת את שעות הפתיחה — כדאי לטלפן לפני שיוצאים."
 *
 * The ring-ahead note a proposal carries when A2 could not check something
 * (docs/decisions/hard-constraints.md). `null` when everything was checked.
 *
 * **Rendered here, never stored.** What the database keeps is the structured
 * `UnverifiedFact[]` the filter produced; this turns it into the sentence at
 * display time, exactly as WEEKDAY_LABELS does for a weekday. An earlier
 * version of A4 stored this English sentence in a column — which in an app
 * that is `lang="he" dir="rtl"` meant every historical row would have had to
 * be migrated to add the Hebrew.
 *
 * It states a fact about the venue and never a comparison: "we could not
 * confirm they are open" is honest, "you got this one because the better
 * place could not be verified" is what spec §5.6 forbids.
 */
export function unverifiedNote(
  facts: readonly UnverifiedFact[]
): string | null {
  if (facts.length === 0) return null;

  const parts = facts.map((fact) =>
    fact.kind === "opening_hours"
      ? "את שעות הפתיחה"
      : `אם הם עומדים בדרישת ${DIETARY_TAG_LABELS[fact.tag] ?? `״${fact.tag}״`}`
  );

  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")} ו${parts[parts.length - 1]}`;

  return `לא הצלחנו לאמת ${list} — כדאי לטלפן ולוודא לפני שיוצאים.`;
}

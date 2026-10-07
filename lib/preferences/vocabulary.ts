// The soft-preference vocabulary (#216, #217): the values a person can hold,
// and the Hebrew each one is shown as. The preference game, the profile, the
// API schema and A7's extraction schema all read it from here, so a value
// cannot exist in one and not the other.
//
// Three things decide a get-together's soft side: what it costs, what kind of
// place it is, and what food it serves. Noise and activity style were the
// first vocabulary's guesses and were dropped (2026-10-07); stored answers to
// them are ignored on read (`softPreferencesFromJson`).

import type { SoftPreferences } from "@/lib/types";

export const BUDGETS = ["modest", "splurge"] as const;
export type Budget = (typeof BUDGETS)[number];

export const BUDGET_LABELS: Record<Budget, string> = {
  modest: "תקציב סטודנטים",
  splurge: "פינוק חד-פעמי",
};

export const VENUE_KINDS = ["bar", "cafe", "restaurant"] as const;
export type VenueKind = (typeof VENUE_KINDS)[number];

export const VENUE_KIND_LABELS: Record<VenueKind, string> = {
  bar: "בר",
  cafe: "בית קפה",
  restaurant: "מסעדה",
};

/**
 * A closed list, approved on #217. Each value maps onto Google Places types
 * (#219), which is why it is a list and not free text: a cuisine the search
 * cannot ask for is a preference nothing can honour. Vegetarian, vegan and
 * kosher are not here — they are dietary hard constraints.
 */
export const CUISINES = [
  "italian",
  "pizza",
  "burger",
  "meat",
  "asian",
  "sushi",
  "middle_eastern",
  "seafood",
  "mexican",
  "indian",
] as const;
export type Cuisine = (typeof CUISINES)[number];

export const CUISINE_LABELS: Record<Cuisine, string> = {
  italian: "איטלקי",
  pizza: "פיצה",
  burger: "המבורגר",
  meat: "בשרים / גריל",
  asian: "אסייתי",
  sushi: "סושי / יפני",
  middle_eastern: "ים-תיכוני / מזרחי",
  seafood: "דגים ופירות ים",
  mexican: "מקסיקני",
  indian: "הודי",
};

function onlyKnown<T extends string>(
  value: unknown,
  known: readonly T[]
): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const kept = [...new Set(value)].filter((v): v is T => known.includes(v));
  return kept.length > 0 ? kept : undefined;
}

/**
 * A stored `softPreferences` value (profile or meeting context), keeping
 * only the fields and values this vocabulary has.
 *
 * The column is JSON and has outlived a vocabulary already: rows written
 * before #217 hold `noiseLevel`, `activityStyle` and a `cuisine` of
 * "familiar"/"adventurous". Casting them straight to `SoftPreferences` would
 * hand A4 answers to questions nobody is asked any more. Each field is kept
 * or dropped on its own, so one stale value does not cost the rest.
 */
export function softPreferencesFromJson(json: unknown): SoftPreferences {
  if (typeof json !== "object" || json === null) return {};
  const raw = json as Record<string, unknown>;
  const budget = BUDGETS.find((b) => b === raw.budget);
  const venueKinds = onlyKnown(raw.venueKinds, VENUE_KINDS);
  const cuisines = onlyKnown(raw.cuisines, CUISINES);
  return {
    ...(budget ? { budget } : {}),
    ...(venueKinds ? { venueKinds } : {}),
    ...(cuisines ? { cuisines } : {}),
  };
}

/* -------------------------------------------------------------------------
 * Against Google Places types (#219)
 * ---------------------------------------------------------------------- */

/**
 * The Places types that make a venue each kind. A place can be several —
 * a bar that serves food lists `bar` and `restaurant` — and is then each.
 */
export const VENUE_KIND_GOOGLE_TYPES: Record<VenueKind, string[]> = {
  bar: ["bar", "pub", "wine_bar", "bar_and_grill"],
  cafe: ["cafe", "coffee_shop", "tea_house"],
  restaurant: ["restaurant"],
};

/** The table approved on #217. */
export const CUISINE_GOOGLE_TYPES: Record<Cuisine, string[]> = {
  italian: ["italian_restaurant"],
  pizza: ["pizza_restaurant"],
  burger: ["hamburger_restaurant"],
  meat: ["steak_house", "barbecue_restaurant"],
  asian: [
    "asian_restaurant",
    "chinese_restaurant",
    "thai_restaurant",
    "vietnamese_restaurant",
  ],
  sushi: ["sushi_restaurant", "japanese_restaurant", "ramen_restaurant"],
  middle_eastern: [
    "mediterranean_restaurant",
    "middle_eastern_restaurant",
    "lebanese_restaurant",
    "turkish_restaurant",
    "greek_restaurant",
  ],
  seafood: ["seafood_restaurant"],
  mexican: ["mexican_restaurant"],
  indian: ["indian_restaurant"],
};

function matching<T extends string>(
  types: readonly string[],
  table: Record<T, string[]>
): T[] {
  return (Object.keys(table) as T[]).filter((value) =>
    table[value].some((type) => types.includes(type))
  );
}

/** The kinds of place a venue's Places types make it, in vocabulary order. */
export function venueKindsOfTypes(types: readonly string[]): VenueKind[] {
  return matching(types, VENUE_KIND_GOOGLE_TYPES);
}

/** The cuisines a venue's Places types name, in vocabulary order. */
export function cuisinesOfTypes(types: readonly string[]): Cuisine[] {
  return matching(types, CUISINE_GOOGLE_TYPES);
}

// What a diner is expected to pay (#249): Google's `priceRange` and
// `priceLevel`, folded into one small `VenuePrice` — and the check that reads
// one back from the database. Pure functions, no I/O, so the client, the
// cache and the proposal can all share them.

import type { PriceLevel, VenuePrice } from "@/lib/types";

/** Google's `Money`: `units` is an int64, so it arrives as a string. */
type RawMoney = {
  currencyCode?: string;
  units?: string | number;
  nanos?: number;
};

export type RawPriceRange = { startPrice?: RawMoney; endPrice?: RawMoney };

const PRICE_LEVELS: readonly PriceLevel[] = [
  "free",
  "inexpensive",
  "moderate",
  "expensive",
  "very_expensive",
];

const LEVEL_BY_GOOGLE_ENUM: Record<string, PriceLevel> = {
  PRICE_LEVEL_FREE: "free",
  PRICE_LEVEL_INEXPENSIVE: "inexpensive",
  PRICE_LEVEL_MODERATE: "moderate",
  PRICE_LEVEL_EXPENSIVE: "expensive",
  PRICE_LEVEL_VERY_EXPENSIVE: "very_expensive",
};

/** A whole amount, or `undefined` when Google sent none (or nonsense). */
function wholeAmountOf(money: RawMoney | undefined): number | undefined {
  if (!money) return undefined;
  // Google omits `units` when it is 0 (proto3 default).
  const value = Number(money.units ?? 0) + (money.nanos ?? 0) / 1e9;
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}

/**
 * Google's `priceLevel` and `priceRange` → one `VenuePrice`, or `undefined`
 * when Google gave neither. An unknown level (or a value Google adds later)
 * is dropped rather than guessed at.
 *
 * A range whose two ends disagree on currency is dropped: there is no honest
 * way to show it. A lower end of 0 is dropped too, so "0 to 50" reads as "up
 * to 50", not "from 0".
 */
export function venuePriceFromGoogle(raw: {
  priceLevel?: string;
  priceRange?: RawPriceRange;
}): VenuePrice | undefined {
  const price: VenuePrice = {};

  const level = raw.priceLevel
    ? LEVEL_BY_GOOGLE_ENUM[raw.priceLevel]
    : undefined;
  if (level) price.level = level;

  const start = raw.priceRange?.startPrice;
  const end = raw.priceRange?.endPrice;
  const currency = start?.currencyCode ?? end?.currencyCode;
  const sameCurrency =
    !start?.currencyCode ||
    !end?.currencyCode ||
    start.currencyCode === end.currencyCode;

  if (currency && sameCurrency) {
    const min = wholeAmountOf(start);
    const max = wholeAmountOf(end);
    if (min !== undefined && min > 0) price.min = min;
    if (max !== undefined) price.max = max;
    if (price.min !== undefined || price.max !== undefined) {
      price.currency = currency;
    }
  }

  return Object.keys(price).length > 0 ? price : undefined;
}

function isAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * A `VenuePrice` read back from a JSON column. Anything that is not the shape
 * written there (a hand edit, a future version) is dropped field by field, and
 * an object with nothing valid left is `undefined` — not known.
 */
export function parseVenuePrice(value: unknown): VenuePrice | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const price: VenuePrice = {};

  if (PRICE_LEVELS.includes(raw.level as PriceLevel)) {
    price.level = raw.level as PriceLevel;
  }
  if (typeof raw.currency === "string" && raw.currency !== "") {
    if (isAmount(raw.min)) price.min = raw.min;
    if (isAmount(raw.max)) price.max = raw.max;
    if (price.min !== undefined || price.max !== undefined) {
      price.currency = raw.currency;
    }
  }

  return Object.keys(price).length > 0 ? price : undefined;
}

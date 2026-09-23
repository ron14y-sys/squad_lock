/**
 * Shared, pure Places geometry — no network, no DB, no clock.
 *
 * One function today, used by two different B7 pieces for two different
 * reasons: `lib/db/places-cache.ts` (B7) rounds a centre to build a cache
 * key that has to be bit-identical across call sites; `lib/places/search-area.ts`
 * (B7b) rounds a centre to dedupe query centres before ever reaching the
 * network. Same rounding, same constant, one definition — a cache key and
 * a dedupe key that disagreed on precision would be a bug neither file's
 * own tests could catch alone.
 */

import type { LatLng } from "@/lib/types";

/**
 * Decimal places kept when a coordinate is rounded to neighbourhood
 * granularity. `spec §5.4` already stores `PreferenceProfile.home{Lat,Lng}`
 * at this granularity for privacy — "the rounding is already there" (spec
 * §6.3) — but this rounds again rather than trusting an upstream caller to
 * have matched that precision exactly. Two coordinates that are the *same
 * neighbourhood* but arrived by different paths (a stored home vs. a
 * `deriveSearchCentres` output) need to land on the identical value for a
 * cache lookup or a dedupe check to ever agree — see the same reasoning
 * `lib/matching/distance.ts`'s `quantise` gives for its own `KEY_DECIMALS`.
 *
 * 2 decimal places of latitude is about 1.1 km; at Tel Aviv's latitude
 * (~32°N) a degree of longitude is narrower, so 2 decimal places there is
 * about 0.9 km — both a reasonable single-neighbourhood cell, not a
 * geographic precision claim.
 */
const KEY_DECIMALS = 2;

const roundCoordinate = (value: number): number => {
  const factor = 10 ** KEY_DECIMALS;
  return Math.round(value * factor) / factor;
};

/** `LatLng` → the exact `(latKey, lngKey)` pair a cache row is looked up by. */
export function roundToNeighbourhood(center: LatLng): {
  latKey: number;
  lngKey: number;
} {
  return {
    latKey: roundCoordinate(center.lat),
    lngKey: roundCoordinate(center.lng),
  };
}

/** The same rounding, back as a `LatLng` — what `deriveSearchCentres` dedupes on. */
export function roundLatLng(center: LatLng): LatLng {
  const { latKey, lngKey } = roundToNeighbourhood(center);
  return { lat: latKey, lng: lngKey };
}

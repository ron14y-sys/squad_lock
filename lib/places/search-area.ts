/**
 * B7b — the search area (spec §5.4).
 *
 * "Candidates are drawn from every participant's own neighbourhood plus the
 * area around each of them, not from a single computed midpoint." Pure
 * geometry, no network: this file decides *where* to search — one query
 * centre per distinct neighbourhood, plus whatever the Context Resolver
 * (A12, not yet built) widens that with — and hands the list to whoever
 * fires the actual `searchNeighbourhoodCached` calls (B7c).
 *
 * **"The area around X" is a radius around the neighbourhood's centre, not
 * a true adjacency graph** — spec §5.4's own implementation note: an
 * adjacency graph "would require a dataset we do not have and would have
 * to maintain."
 *
 * ## The widening-only invariant
 *
 * "The Context Resolver may add search regions, merge them, or enlarge a
 * radius; it may never remove one or shrink below the deterministic
 * baseline" (spec §4.1g). `extraRegions` is that Resolver's channel into
 * this function, and the invariant is structural here, not just documented:
 * every baseline centre is already in the returned array before
 * `extraRegions` is even looked at, and nothing below ever filters the
 * baseline — only the final dedupe, which can merge an extra region into an
 * existing centre but can never make a baseline centre disappear. The test
 * for this ("the widened union always contains the baseline") is the same
 * shape spec §4.3 describes for the Resolver's own guard-rail tests.
 */

import type { LatLng } from "@/lib/types";
import { roundLatLng } from "./geo";

/**
 * Metres around a neighbourhood centre a search covers. Open question #15
 * (spec §13): "What radius... tune against your own real addresses." This
 * is a starting estimate — a walkable-to-short-drive neighbourhood radius
 * in a dense city — not a validated number. **Nothing in this codebase can
 * validate it**: that needs a real `GOOGLE_PLACES_API_KEY` and eyeballing
 * real results against real addresses, per the B7b acceptance criterion in
 * `tasks/todo.md` ("real restaurants, no park, no sea").
 */
export const SEARCH_RADIUS_METERS = 2000;

/**
 * The deterministic search-area baseline, plus whatever `extraRegions` a
 * future Context Resolver call adds — deduplicated to one centre per
 * neighbourhood (see `lib/places/geo.ts`'s `roundLatLng` for why the
 * rounding here has to match the cache's).
 *
 * `origins` should already be each participant's resolved travel origin —
 * this function does not know about `Participant`, `context`, or the
 * amendment-outranks-home precedence spec §5.4 describes; that resolution
 * happens before this is called. A `null` origin (spec: falls back to
 * home, but a participant can in principle have neither) is the caller's
 * problem to filter out, not this function's — passing an empty array for
 * `origins` returns exactly `extraRegions`, deduplicated.
 */
export function deriveSearchCentres(
  origins: LatLng[],
  extraRegions: LatLng[] = []
): LatLng[] {
  const centres: LatLng[] = [];
  const seen = new Set<string>();

  for (const origin of [...origins, ...extraRegions]) {
    const rounded = roundLatLng(origin);
    const key = `${rounded.lat},${rounded.lng}`;
    if (seen.has(key)) continue;
    seen.add(key);
    centres.push(rounded);
  }

  return centres;
}

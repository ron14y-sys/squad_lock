/**
 * A3 — the burden of a venue on a person, and leximin fairness (spec §5.4).
 *
 * A2 answers **"is this `(venue, slot)` pair possible at all"** — a yes or a
 * no. This file answers the next question: **"how bad is it for each person,
 * and which candidate is fairest"** — a number, and then an ordering.
 *
 * ## The number
 *
 * ```
 * burden = straight_line_distance × detour_factor / tolerance_km
 * ```
 *
 * Dimensionless. `1.0` is exactly the distance that person said they were
 * comfortable with; `1.4` is half again as far. Being dimensionless is the
 * point — it is what lets six people with six different tolerances be
 * compared on one axis without inventing an exchange rate between them.
 *
 * ## The ordering
 *
 * **Leximin.** Sort a candidate's per-participant burdens worst-first, then
 * compare two candidates lexicographically: worst against worst, and only on
 * a tie move to the second-worst, then the third.
 *
 * ```
 * [1.8, 1.2, 0.9]  beats  [1.8, 1.5, 0.4]   — tie on the worst, decided on the second
 * ```
 *
 * Plain minimax — comparing only `max(burden)` — is degenerate: two
 * candidates with the same worst-off participant are *equivalent* under it,
 * even when one is far better for everyone else, so the tie falls through to
 * star rating and the fairness quietly disappears. Leximin is the standard
 * refinement of maximin in social choice theory and costs about five lines.
 *
 * Worst-case rather than average, deliberately: averaging lets a group
 * repeatedly pick venues next door to three people and far from the fourth,
 * and that person stops showing up.
 *
 * ## ⚠️ This is not travel time
 *
 * The burden figure is a deterministic geographic estimate — a straight line
 * with a correction factor — **not a routed journey. The system does not
 * calculate real driving or travel time, and nothing here, in the UI, or in
 * the report may say that it does** (spec §5.4). The Routes API is the
 * upgrade path if that ever changes; it is deliberately not an MVP
 * dependency.
 *
 * ## Everything here is pure
 *
 * No LLM, no network, no clock, no I/O. The same input always gives the same
 * answer, which is what makes the fairness guarantee testable rather than
 * merely stated — and what keeps a failing eval scenario attributable to a
 * stage (spec §9).
 *
 * ## Where the boundaries are
 *
 * - **A2 (`constraints.ts`) owns possibility.** This file never re-checks a
 *   hard constraint and does not import that one. A person with no mobility
 *   mode at all is A2's `immobile` violation, not a tolerance of zero here.
 * - **B7c owns the gate.** Dropping a candidate whose burden exceeds `T` is
 *   the funnel's job, and `T`'s value is still open (spec §13, item 3). This
 *   file produces the number that gate will read; it never applies it.
 * - **B7c also owns the shortlist** — the dedupe, the parallel list ranked by
 *   rating, and the fill. Nothing here reads `rating` at all, because spec
 *   §5.4 rules out weighing kilometres against stars: there is no exchange
 *   rate between them, and a weighted sum lets a good rating buy its way past
 *   unfairness.
 * - **A12 (the Context Resolver) owns the parameters.** The detour factor and
 *   the per-slot tolerance arrive as arguments, never read from a model here.
 *   Until A12 exists they default to `1.0` and the profile's `toleranceKm`,
 *   which is the deterministic baseline.
 */

import type { Kilometres, LatLng } from "@/lib/types";

/* -------------------------------------------------------------------------
 * Failures
 *
 * Four ways the arithmetic can be asked something it cannot answer. All four
 * throw rather than returning a sentinel, and the reason is specific to this
 * file: a `NaN` burden does not fail loudly, it *randomises*. `NaN < x` and
 * `NaN > x` are both false, so a single bad coordinate would not produce a
 * wrong answer anyone could see — it would produce an arbitrary ranking that
 * looks entirely normal.
 * ---------------------------------------------------------------------- */

export type BurdenErrorKind =
  /** Somebody has no origin to measure from — onboarding is unfinished. */
  | "no_origin"
  /** A tolerance of zero, negative, or not a number. A broken profile. */
  | "bad_tolerance"
  /** A latitude, longitude or distance that is not a real point on Earth. */
  | "bad_coordinates"
  /** A candidate reached the scorer with no slot it is usable at. */
  | "no_viable_slot";

/**
 * Thrown by everything in this file. Carries the kind and, where the fault is
 * a person's missing data rather than a venue's, who it belongs to — so a
 * caller can name them in a message to the group instead of logging an id.
 */
export class BurdenError extends Error {
  readonly kind: BurdenErrorKind;
  /** `null` when the fault is the venue's or the caller's, not a person's. */
  readonly participantId: string | null;

  constructor(
    kind: BurdenErrorKind,
    message: string,
    participantId: string | null = null
  ) {
    super(message);
    this.name = "BurdenError";
    this.kind = kind;
    this.participantId = participantId;
  }
}

/* -------------------------------------------------------------------------
 * Straight-line distance
 * ---------------------------------------------------------------------- */

/** Mean Earth radius in kilometres. The usual spherical approximation. */
const EARTH_RADIUS_KM = 6371;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** A real point on Earth, or a thrown error. Never a silent `NaN`. */
function assertCoordinates(point: LatLng, label: string): void {
  const { lat, lng } = point;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new BurdenError(
      "bad_coordinates",
      `distance: ${label} is not a finite coordinate (${lat}, ${lng})`
    );
  }
  if (lat < -90 || lat > 90) {
    throw new BurdenError(
      "bad_coordinates",
      `distance: ${label} has a latitude of ${lat}, which is not on Earth`
    );
  }
  if (lng < -180 || lng > 180) {
    throw new BurdenError(
      "bad_coordinates",
      `distance: ${label} has a longitude of ${lng}, which is not on Earth`
    );
  }
}

/**
 * Great-circle distance in kilometres, by the haversine formula.
 *
 * **Deliberately not rounded.** `lib/spike/payload.ts` has a private copy of
 * this that rounds to 100 m for payload readability; that would be wrong
 * here, because rounding manufactures exact ties in the burden vector and
 * resolving past a tie is the whole job of leximin. The two are not the same
 * function and should not be unified — the spike's is frozen for the F2
 * measurement.
 *
 * The rounding that *is* applied happens once, in `leximinVector`, on the
 * comparison key only. See the note there.
 */
export function straightLineKm(from: LatLng, to: LatLng): Kilometres {
  assertCoordinates(from, "the origin");
  assertCoordinates(to, "the destination");

  const fromLat = toRadians(from.lat);
  const toLat = toRadians(to.lat);
  const deltaLat = toLat - fromLat;
  const deltaLng = toRadians(to.lng - from.lng);

  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLng / 2) ** 2;

  // `asin` rather than `atan2`: both are exact here, and this is the form the
  // formula is usually written in, so it reads against any reference.
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* -------------------------------------------------------------------------
 * The burden formula
 * ---------------------------------------------------------------------- */

/**
 * The detour factor, made safe: `>= 1.0` always, and `1.0` when it is absent
 * or nonsense.
 *
 * A factor below 1.0 would claim a journey is *shorter* than the straight
 * line between its ends, which is not a thing. `lib/types/matching.ts`
 * already says as much — "clamped on the way in; a model that returns less is
 * wrong" — and this is that clamp.
 *
 * **Why this clamps where the tolerance throws.** The detour factor is a
 * *correction*: drop a broken one and the answer is still valid, merely
 * uncorrected. The tolerance is a *denominator*: with a broken one there is
 * no answer at all. So a bad factor costs accuracy and a bad tolerance costs
 * the run.
 */
export function clampDetourFactor(factor: number | undefined): number {
  if (factor === undefined || !Number.isFinite(factor)) return 1;
  return Math.max(1, factor);
}

/**
 * A tolerance that can be divided by, or a thrown error naming whose it is.
 *
 * Zero is rejected rather than read as "will not travel at all": that state
 * already belongs to A2, as an `immobile` violation derived from mobility
 * windows (see `docs/decisions/hard-constraints.md`). Two encodings of one
 * fact is how the two halves of the funnel drift apart.
 */
export function assertToleranceKm(
  toleranceKm: number,
  who?: { id: string; name: string }
): asserts toleranceKm is Kilometres {
  if (Number.isFinite(toleranceKm) && toleranceKm > 0) return;

  throw new BurdenError(
    "bad_tolerance",
    who
      ? `distance: ${who.name}'s travel tolerance is ${toleranceKm} km, which cannot be divided by`
      : `distance: a travel tolerance of ${toleranceKm} km cannot be divided by`,
    who?.id ?? null
  );
}

/**
 * The sentence spec §5.4 commits to, on its own:
 *
 * ```
 * burden = straight_line_distance × detour_factor / tolerance_km
 * ```
 *
 * Exported separately from anything geographic so the formula can be pinned
 * by a test with no coordinates in it at all.
 */
export function burdenValue(
  distanceKm: Kilometres,
  detourFactor: number,
  toleranceKm: Kilometres
): number {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    throw new BurdenError(
      "bad_coordinates",
      `distance: ${distanceKm} km is not a distance`
    );
  }
  assertToleranceKm(toleranceKm);

  return (distanceKm * clampDetourFactor(detourFactor)) / toleranceKm;
}

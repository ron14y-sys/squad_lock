/**
 * B7c, part one — the candidate funnel's deterministic half (spec §5.4).
 *
 * ```
 * per-neighbourhood queries → dedupe → drop hard-constraint violations
 *    → drop anything open at no viable time (§5.7)
 *    → gate: drop any candidate where some participant's burden exceeds T
 *    → top N/2 by leximin  +  top N/2 by rating   (overlap frees slots)
 *    → shortlist of N ≈ 20–24 → matching agent
 * ```
 *
 * Everything up to and including the gate is here, and it is pure — no
 * network, no DB, no clock. `A2` (`constraints.ts`'s `filterTrimmedPairs`)
 * and `A3` (`distance.ts`'s `rankViable`) already exist and are reused
 * as-is; the one thing genuinely missing before this file was the gate
 * itself — `distance.ts`'s own header names it as B7c's job and stops
 * short of applying it.
 *
 * **The dual list is not built here.** `distance.ts`'s header also
 * describes "the parallel list ranked by rating" as B7c's job, but rating
 * is an Enterprise-tier Places field (spec §6.3), fetched only for the
 * shortlist — it cannot exist yet at the point a shortlist is *chosen*.
 * Per spec's own framing of that open question ("if it is only a
 * preference, it can move to the shortlist detail call or be dropped
 * entirely" — §13, item 6), this funnel fills entirely by leximin. `rating`
 * is fetched afterward, by the second half of B7c, once there is a
 * shortlist to fetch it for.
 *
 * **Opening hours are provisional here too, for the same reason.**
 * `filterTrimmedPairs` narrows by opening hours when `candidate.openingHours`
 * is set, and treats an unset one as open the whole window — which is what
 * every candidate looks like at this stage, since real hours are also
 * Enterprise-tier and not yet fetched. The second half of B7c re-runs the
 * trim with real hours once it has them, which can shrink or drop a
 * candidate this file accepted.
 */

import type { Candidate, Kilometres, Participant, TimeSlot } from "@/lib/types";
import {
  filterTrimmedPairs,
  MINIMUM_MEETING_MINUTES,
  type ConstraintInput,
  type PairCheck,
  type VenueDietaryFacts,
} from "./constraints";
import {
  originOf,
  rankViable,
  straightLineKm,
  type BurdenOptions,
  type CandidateScore,
} from "./distance";

/**
 * The burden gate, spec §13's open question #3: "twice a person's stated
 * comfortable distance," start here, tune against eval quality. A candidate
 * survives only if every participant's burden **at their most permissive
 * slot** — `CandidateScore.leximin[0]`, already the worst entry in a
 * worst-first vector — is at or under this. Tunable.
 */
export const BURDEN_GATE_T = 2.0;

/**
 * N, spec §5.4: "shortlist of N ≈ 20–24." A cap, not a floor — a pool
 * smaller than this after gating is not padded, and whether that should
 * trigger B7b's adaptive expansion (more query centres) is a decision for
 * whoever calls this, not this file (see spec §5.4's own retrieval/scoring
 * split: narrowing here is what expansion exists to correct, not something
 * this funnel corrects for itself).
 */
export const SHORTLIST_SIZE = 24;

/**
 * One `Candidate` per `placeId`, first occurrence kept.
 *
 * "First" is deterministic, not arbitrary: candidates arrive in
 * `deriveSearchCentres`' order, itself the order `origins` and then
 * `extraRegions` were given in — so the same inputs always dedupe the same
 * way, which matters under spec §5.4's warning that Places does not
 * guarantee identical results for identical requests. A second sighting of
 * a `placeId` is the same real venue by construction (`placeId` is Google's
 * own identity for it), so which copy survives changes nothing about the
 * venue itself — only determinism about *which* candidate object is used.
 */
export function dedupeCandidates(
  candidates: readonly Candidate[]
): Candidate[] {
  const seen = new Set<string>();
  const deduped: Candidate[] = [];

  for (const candidate of candidates) {
    if (seen.has(candidate.placeId)) continue;
    seen.add(candidate.placeId);
    deduped.push(candidate);
  }

  return deduped;
}

export type FunnelInput = {
  /** The raw, merged pool from every `searchNeighbourhoodCached` call — not yet deduped. */
  candidates: Candidate[];
  participants: Participant[];
  /** The group's free windows — B6's `commonFreeWindows` output. */
  slots: TimeSlot[];
  venueFacts?: Record<string, VenueDietaryFacts>;
  minimumMinutes?: number;
  burdenOptions?: BurdenOptions;
};

export type FunnelResult = {
  /** Gated, ranked fairest-first, capped at `SHORTLIST_SIZE`. Provisional — see this file's header comment. */
  shortlist: CandidateScore[];
  /** Every `(candidate, slot)` pair `filterTrimmedPairs` dropped, with why. */
  droppedPairs: PairCheck[];
  /**
   * Survived `filterTrimmedPairs` and `rankViable`'s ranking, but failed
   * the burden gate — kept separate from `droppedPairs` because this is a
   * whole-candidate decision, not a per-pair one, and because a run is
   * persisted in full (spec §4.1d): "gated on burden" is a different,
   * reportable reason than "no viable slot."
   */
  gatedOut: CandidateScore[];
};

/**
 * Distances from every participant's resolved origin to one candidate —
 * the same `straightLineKm(originOf(participant), candidate.location)`
 * `distance.ts`'s own `burdensFor` computes, built once here so
 * `filterTrimmedPairs`'s reach check and `rankViable`'s burden scoring
 * agree on the same numbers for the same pair.
 */
function distancesTo(
  candidate: Candidate,
  participants: readonly Participant[]
): Readonly<Record<string, Kilometres>> {
  const distances: Record<string, Kilometres> = {};
  for (const participant of participants) {
    distances[participant.userId] = straightLineKm(
      originOf(participant),
      candidate.location
    );
  }
  return distances;
}

/**
 * Dedupe → `filterTrimmedPairs` (opening-hours-provisional, reach, minimum
 * length) → `rankViable` (score + leximin rank) → the burden gate → cap at
 * `SHORTLIST_SIZE`.
 *
 * `candidates` need not be deduped by the caller — this is where that
 * happens, so a caller that merges several `searchNeighbourhoodCached`
 * calls does not have to remember to.
 */
export function buildShortlist(input: FunnelInput): FunnelResult {
  const deduped = dedupeCandidates(input.candidates);
  const minimumMinutes = input.minimumMinutes ?? MINIMUM_MEETING_MINUTES;

  const constraintInput: ConstraintInput = {
    candidates: deduped,
    participants: input.participants,
    slots: input.slots,
    venueFacts: input.venueFacts,
  };

  const filtered = filterTrimmedPairs(
    constraintInput,
    (candidate) => distancesTo(candidate, input.participants),
    minimumMinutes
  );

  const ranked = rankViable(
    filtered,
    deduped,
    input.participants,
    input.burdenOptions
  );

  const gatedOut: CandidateScore[] = [];
  const passed: CandidateScore[] = [];
  for (const score of ranked) {
    // leximin is worst-first — index 0 is the worst-off participant, at
    // their most permissive slot (see BURDEN_GATE_T's own comment).
    if (score.leximin[0] > BURDEN_GATE_T) {
      gatedOut.push(score);
    } else {
      passed.push(score);
    }
  }

  return {
    shortlist: passed.slice(0, SHORTLIST_SIZE),
    droppedPairs: filtered.dropped,
    gatedOut,
  };
}

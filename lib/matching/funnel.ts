/**
 * B7c — the candidate funnel (spec §5.4).
 *
 * ```
 * per-neighbourhood queries → dedupe → drop hard-constraint violations
 *    → drop anything open at no viable time (§5.7)
 *    → gate: drop any candidate where some participant's burden exceeds T
 *    → top N/2 by leximin  +  top N/2 by rating   (overlap frees slots)
 *    → shortlist of N ≈ 20–24 → matching agent
 * ```
 *
 * The whole pipeline is here, and it is pure — no network, no DB, no clock.
 * `A2` (`constraints.ts`'s `filterTrimmedPairs`) and `A3` (`distance.ts`'s
 * `rankViable`) already exist and are reused as-is. Three things were
 * genuinely missing before this file: the gate itself, the parallel list
 * ranked by rating, and the fill that combines the two — `distance.ts`'s own
 * header names all three as B7c's job and stops short of them
 * ("Fairness and rating are two parallel lists at B7c, never one weighted
 * sum").
 *
 * **The dual list, corrected.** An earlier version of this file argued rating
 * couldn't be built into the fill here, because it is an Enterprise-tier
 * Places field (spec §6.3) fetched only for the shortlist — and a shortlist
 * cannot be selected using data it doesn't have yet. That is true, but it
 * does not mean the dual list should be dropped; spec §13's own "Resolved
 * during specification" list already answers this, not §13's open item 6:
 * *"How many candidates enter the matching run? → 20–24, filled from two
 * parallel ranked lists."* `fillShortlist` below builds both lists every
 * time, and the Enterprise-tier problem solves itself from the data rather
 * than a mode flag: on the first, provisional pass over a raw search pool —
 * before anyone has a `rating` — the rating list is empty and the fill
 * degrades to leximin alone, exactly the old behaviour. It only actually
 * produces a second list on a pass run *after* Enterprise details have been
 * fetched for a prior shortlist — which is `run-cycle.ts`'s `assembleRun`,
 * described next.
 *
 * **Opening hours are provisional on the first pass, for the same reason.**
 * `filterTrimmedPairs` narrows by opening hours when `candidate.openingHours`
 * is set, and treats an unset one as open the whole window — which is what
 * every candidate looks like on a pool straight from search, since real
 * hours are Enterprise-tier too. This file stays single-pass and pure; it is
 * the caller's job to run it twice. `assembleRun` (`run-cycle.ts`, A8) does
 * exactly that: once over the raw pool to choose the ~24 worth paying for,
 * then again over those same ~24 once `fetchPlaceDetailsCached` has attached
 * real `rating` and `openingHours` — which is where both the dual list and
 * the real opening-hours trim actually take effect, and where a candidate
 * this file accepted provisionally can shrink or drop.
 *
 * **What is still an open assumption, not a decision.** Spec §13 item 6 asks
 * whether `rating` is required for correctness or merely a ranking signal,
 * and leaves it open. This file assumes the latter: `Candidate.rating` is
 * optional, a candidate with none simply cannot appear in the rating list
 * (there is nothing to sort it by), and nothing here treats a missing rating
 * as a fault. That is a stated assumption standing in for an unmade
 * decision, not a resolution of item 6.
 */

import type { Candidate, Kilometres, Participant, TimeSlot } from "@/lib/types";
import {
  filterTrimmedPairs,
  MINIMUM_MEETING_MINUTES,
  type ConstraintInput,
  type PairCheck,
  type VenueDietaryFacts,
  type ViablePair,
} from "./constraints";
import {
  compareLeximin,
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
 * #221: at most this share of the shortlist is brought in by a profile
 * preference — a third, agreed on the issue. Tunable.
 */
export const PREFERRED_SHARE = 1 / 3;

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
  /**
   * #221: venues matching a kind or cuisine someone listed in their profile.
   * A third list in the fill (`fillShortlist`), never a reordering of the
   * other two.
   */
  preferred?: ReadonlySet<string>;
  minimumMinutes?: number;
  burdenOptions?: BurdenOptions;
};

export type FunnelResult = {
  /**
   * Gated, filled from the leximin and rating lists (`fillShortlist`),
   * capped at `SHORTLIST_SIZE`. On a raw-search-pool pass this is leximin
   * only, because nothing has a `rating` yet — see this file's header.
   */
  shortlist: CandidateScore[];
  /**
   * The surviving `(venue, slot)` pairs **of the shortlisted candidates** —
   * `MatchAgentInput.viable`, which A4 describes as the set the agent sees
   * and nothing else.
   *
   * Narrowed to the shortlist rather than returned whole, because the two
   * lists have to agree: a pair whose venue lost at the burden gate is not
   * one the agent may pick, and handing it both would make that reachable.
   *
   * `filterTrimmedPairs` computes these on the way through and, until A8,
   * they were dropped on the floor — `evals/adapter.ts` needed the same
   * pairs and ran that filter a second time, from the fixture side, to get
   * them back.
   */
  viable: ViablePair[];
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
 * Two parallel ranked lists — leximin and rating — walked together and
 * merged into one shortlist of at most `size`, spec §5.4 and §13's resolved
 * "filled from two parallel ranked lists."
 *
 * "Overlap frees slots" is read literally: rather than capping each list at
 * a fixed `size / 2` and leaving room unused when the lists agree, the two
 * are walked in lockstep, each already-taken candidate is skipped, and
 * whichever list still has more keeps contributing until `size` is reached
 * or both run out. A candidate that leads both lists costs one slot, not
 * two, and the next name on either list moves up to fill what would have
 * been the other.
 *
 * `byLeximin` is `passed`, already fairest-first (`rankViable`'s contract).
 * `byRating` holds only candidates that have a `rating` at all — nothing
 * from a raw search result does (spec §6.3), so on that pass this list is
 * empty and the fill is leximin alone, unchanged from before this file grew
 * a second list. Ties in `byRating` break on leximin (the fairer of two
 * equally-rated venues sorts first) and then on `placeId`, for the same
 * determinism reason `compareCandidatesByLeximin` breaks on it — Places does
 * not promise the same request returns results in the same order twice.
 */
function fillShortlist(
  passed: readonly CandidateScore[],
  size: number,
  preferred: ReadonlySet<string> = new Set()
): CandidateScore[] {
  const byLeximin = passed;
  // #221: a mild boost, not a ranking. Fairest-first like `byLeximin`, it
  // walks third in each round and stops at `PREFERRED_SHARE` of the list, so
  // a profile preference can bring a venue in but never crowd fairness out —
  // and everything here has already passed the burden gate.
  const byPreference = passed.filter((score) =>
    preferred.has(score.candidate.placeId)
  );
  const preferredCap = Math.floor(size * PREFERRED_SHARE);
  const byRating = [...passed]
    .filter((score) => score.candidate.rating !== undefined)
    .sort((a, b) => {
      const byStars = b.candidate.rating! - a.candidate.rating!;
      if (byStars !== 0) return byStars;
      const byFairness = compareLeximin(a.leximin, b.leximin);
      if (byFairness !== 0) return byFairness;
      return a.candidate.placeId.localeCompare(b.candidate.placeId);
    });

  const result: CandidateScore[] = [];
  const taken = new Set<string>();

  const takeNext = (list: readonly CandidateScore[], from: number): number => {
    let i = from;
    while (i < list.length && taken.has(list[i].candidate.placeId)) i += 1;
    if (i < list.length) {
      taken.add(list[i].candidate.placeId);
      result.push(list[i]);
      i += 1;
    }
    return i;
  };

  let li = 0;
  let ri = 0;
  let pi = 0;
  let fromPreference = 0;
  while (
    result.length < size &&
    (li < byLeximin.length || ri < byRating.length)
  ) {
    if (li < byLeximin.length) li = takeNext(byLeximin, li);
    if (result.length >= size) break;
    if (ri < byRating.length) ri = takeNext(byRating, ri);
    if (result.length >= size) break;
    if (fromPreference < preferredCap && pi < byPreference.length) {
      const before = result.length;
      pi = takeNext(byPreference, pi);
      fromPreference += result.length - before;
    }
  }

  return result;
}

/**
 * Dedupe → `filterTrimmedPairs` (opening-hours-provisional, reach, minimum
 * length) → `rankViable` (score + leximin rank) → the burden gate →
 * `fillShortlist` (leximin + rating, capped at `SHORTLIST_SIZE`).
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

  const shortlist = fillShortlist(passed, SHORTLIST_SIZE, input.preferred);
  const shortlisted = new Set(
    shortlist.map((score) => score.candidate.placeId)
  );

  return {
    shortlist,
    viable: filtered.viable.filter((pair) =>
      shortlisted.has(pair.candidatePlaceId)
    ),
    droppedPairs: filtered.dropped,
    gatedOut,
  };
}

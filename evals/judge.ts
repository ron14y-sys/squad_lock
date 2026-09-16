/**
 * Is an eval answer *right*?
 *
 * A4 proves an answer is **legal** — `assertChosenPairAllowed` re-tests the
 * pair it chose. Nothing before this file asks whether it is the answer the
 * three of us agreed on. `scenario.expected` is the oracle, and this is the
 * only thing that reads it.
 *
 * Pure and deterministic: no model, no network, no clock. Everything here can
 * be tested without spending a request from a 20-a-day quota, which is most of
 * why it is a separate file from the runner.
 */

import { type Scenario } from "./adapter";
import type { MatchRunDraft } from "@/lib/matching/agent";
import { APP_TIME_ZONE } from "@/lib/types";

/* -------------------------------------------------------------------------
 * What a scenario is worth today
 * ---------------------------------------------------------------------- */

/**
 * `scored` — judgeable now. `blocked` and `deferred` — a stage the answer
 * depends on has not been built, so a wrong answer here measures the gap and
 * not the model.
 *
 * | Scenario   | Waiting on           | Because                                            |
 * | ---------- | -------------------- | -------------------------------------------------- |
 * | `04`       | A12 Context Resolver | leximin on a bare straight line picks the other venue |
 * | `07`, `08` | A7 + A8              | `expected` is the proposal *after* a rejection     |
 *
 * **`03` and `05` used to be here too**, waiting on the trimming. The adapter
 * now trims, so they are scored — and `05` is the one that mattered most: its
 * agreed answer was being filtered out entirely while a *different* venue
 * survived and was proposed. A missing stage reported as a bad model is the
 * expensive kind of wrong.
 *
 * `04` is the one that is still easy to get wrong, because it produces a
 * legal, plausible, **wrong** answer rather than an obviously missing one. Its
 * own `expected.reasoning` says so outright: _"a naive straight-line-only
 * implementation is expected to get this one wrong; that gap is exactly what
 * this scenario measures."_
 *
 * **Derived, never listed.** `trap` names the stage a scenario exercises, so a
 * scenario added tomorrow is classified by rule. When a stage lands, its
 * scenarios become `scored` with no edit here — which is exactly what just
 * happened to `03` and `05`.
 */
export type Classification = "scored" | "blocked" | "deferred";

export function classify(scenario: Scenario): Classification {
  if (scenario.trap === "rejection-loop") return "deferred";
  if (scenario.trap === "semantic-geography") return "blocked";
  return "scored";
}

/** Which missing stage, in the words the table prints. */
export function blockedReason(scenario: Scenario): string {
  if (scenario.trap === "rejection-loop") return "needs A7/A8";
  if (scenario.trap === "semantic-geography") return "needs A12";
  return "needs B6";
}

/* -------------------------------------------------------------------------
 * The judgement
 * ---------------------------------------------------------------------- */

export type Verdict = { pass: boolean; reason?: string };

/**
 * `expected.venue` is a name; the engine answers with a `placeId`.
 *
 * Resolved through the scenario's own `candidateVenues`, so the comparison is
 * on the id — the same key A2, A3 and the dedupe use. **A name that resolves
 * to nothing raises**: that is a broken fixture, and a broken fixture must not
 * be able to arrive in the table looking like a model failure.
 */
export function expectedPlaceId(scenario: Scenario): string {
  const venue = scenario.candidateVenues.find(
    (candidate) => candidate.name === scenario.expected.venue
  );
  if (!venue) {
    throw new Error(
      `scenario "${scenario.id}" expects "${scenario.expected.venue}", which is not one of its candidateVenues`
    );
  }
  return venue.placeId;
}

// The instant back to the wall clock a person wrote in the fixture. Comparing
// wall clocks rather than instants is what keeps 07's "00:00" end from needing
// a date at all — it is simply the next midnight, formatted.
const CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * Rank 1 against `expected`.
 *
 * **Rank 1 only.** Ranks 2 and 3 are "we also considered"; the proposal is
 * rank 1, and that is what spec §12 measures.
 *
 * The time is checked exactly when the scenario states one — `expected.time`
 * is present precisely when something narrows the group's window
 * (`evals/README.md`), which is when the answer is a `(venue, time)` pair
 * rather than a venue.
 */
export function judge(scenario: Scenario, draft: MatchRunDraft): Verdict {
  const option = draft.options.find((candidate) => candidate.rank === 1);
  if (!option) return { pass: false, reason: "no rank-1 option" };

  if (option.venue.placeId !== expectedPlaceId(scenario)) {
    return {
      pass: false,
      reason: `chose ${option.venue.name}, expected ${scenario.expected.venue}`,
    };
  }

  const want = scenario.expected.time;
  if (!want) return { pass: true };

  const start = CLOCK.format(option.proposedDatetime);
  const end = CLOCK.format(option.proposedEnd);
  if (start !== want.start || end !== want.end) {
    return {
      pass: false,
      reason: `right venue at ${start}–${end}, expected ${want.start}–${want.end}`,
    };
  }

  return { pass: true };
}

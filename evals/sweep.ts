/**
 * What a sweep adds up to — the counting half of `scripts/run-evals.ts`.
 *
 * The runner calls a model; this file never does. It holds the three things
 * the table and the exit code are computed from — the violation count, the
 * totals, and the exit code itself — so they can be tested on `npm test` with
 * no key and no quota. Two of them have already been wrong once: the pass rate
 * counted scenarios that never produced an answer, and a check that only ever
 * runs inside a script is a check nobody has run.
 */

import type { Scenario } from "./adapter";
import type { MatchAgentInput, MatchRunDraft } from "@/lib/matching/agent";
import {
  checkChosenPair,
  type ConstraintInput,
} from "@/lib/matching/constraints";
import { totalCost, type Cost, type CostTotal } from "@/lib/llm/cost";

/** One row of the table. */
export type Row = {
  scenario: Scenario;
  state: "pass" | "fail" | "error" | "blocked" | "deferred";
  detail: string;
  cost?: Cost;
  ms?: number;
  violations: number;
  /** See `distinctJustifications`. */
  distinct?: string;
};

/**
 * The post-check, run again by the runner rather than trusted.
 *
 * `runMatchingAgent` already calls `assertChosenPairAllowed` on all three
 * options — but a check that only ever runs inside the thing it is checking is
 * not a check, and this is the one column spec §12 says must be zero. It costs
 * nothing: A2 is pure.
 */
export function countViolations(
  input: MatchAgentInput,
  draft: MatchRunDraft
): number {
  const slots = new Map(
    input.viable.map((pair) => [
      `${pair.slot.start.toISOString()}/${pair.slot.end.toISOString()}`,
      pair.slot,
    ])
  );
  const constraintInput: ConstraintInput = {
    candidates: input.candidates,
    participants: input.participants,
    slots: [...slots.values()],
    venueFacts: input.venueFacts,
  };

  return draft.options.reduce(
    (found, option) =>
      found +
      checkChosenPair(
        {
          // Null cannot be a candidate, so A2 reports it as one — which is
          // the right answer, not a crash.
          candidatePlaceId: option.venue.placeId ?? "",
          slot: { start: option.proposedDatetime, end: option.proposedEnd },
        },
        constraintInput
      ).length,
    0
  );
}

/**
 * Rank 1's different explanations over its people — `2/4`. Information, never
 * a verdict (A6): identical people honestly get one sentence, as in `02`.
 */
export function distinctJustifications(draft: MatchRunDraft): string {
  const top = draft.options.find((option) => option.rank === 1);
  const reasons = Object.values(top?.participantJustifications ?? {});
  return `${new Set(reasons).size}/${reasons.length}`;
}

export type Summary = {
  /** Rows where an answer came back and was judged. The denominator. */
  scored: number;
  passed: number;
  /** Whole percent of `scored`; 0 when nothing was scored. */
  rate: number;
  /** Calls that errored before any answer arrived. Named, never scored. */
  unreached: number;
  blocked: number;
  deferred: number;
  violations: number;
  /** `null` when no call was made. An unpriced call stays unpriced, not $0. */
  cost: CostTotal | null;
  ms: number;
};

/**
 * The totals line.
 *
 * **Scored means an answer came back and was judged.** A call that never
 * returned one was not measured, and folding it into the denominator reports
 * the model as wrong when the API had simply said "later" — one run printed
 * "4 scored · 1 passed (25%)" when 1 of 1 attempted had passed.
 */
export function summarize(rows: Row[]): Summary {
  const count = (state: Row["state"]) =>
    rows.filter((row) => row.state === state).length;

  const scored = rows.filter((row) => row.cost !== undefined).length;
  const passed = count("pass");
  const costs = rows.flatMap((row) => (row.cost ? [row.cost] : []));

  return {
    scored,
    passed,
    rate: scored ? Math.round((passed / scored) * 100) : 0,
    unreached: rows.filter(
      (row) => row.state === "error" && row.cost === undefined
    ).length,
    blocked: count("blocked"),
    deferred: count("deferred"),
    violations: rows.reduce((sum, row) => sum + row.violations, 0),
    cost: costs.length ? totalCost(costs) : null,
    ms: rows.reduce((sum, row) => sum + (row.ms ?? 0), 0),
  };
}

/**
 * Non-zero on a hard-constraint violation or an error — **never on the pass
 * rate.** A model's judgement is not a thing to fail a command on; the one
 * invariant that is hard is.
 */
export function exitCode(rows: Row[]): 0 | 1 {
  const violations = rows.some((row) => row.violations > 0);
  const errored = rows.some((row) => row.state === "error");
  return violations || errored ? 1 : 0;
}

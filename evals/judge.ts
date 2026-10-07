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
import type {
  ConstraintUpdate,
  DistanceRequest,
  ObjectionKind,
  StartRequest,
} from "@/lib/extraction/constraint-updater";
import type { TonightCorrection } from "@/lib/types";
import { APP_TIME_ZONE } from "@/lib/types";

/* -------------------------------------------------------------------------
 * What a scenario is worth today
 * ---------------------------------------------------------------------- */

/**
 * `scored` — judgeable now. `blocked` and `deferred` — a stage the answer
 * depends on has not been built, so a wrong answer here measures the gap and
 * not the model.
 *
 * | Scenario | Waiting on           | Because                                               |
 * | -------- | -------------------- | ----------------------------------------------------- |
 * | `04`     | A12 Context Resolver | leximin on a bare straight line picks the other venue |
 *
 * **`08` is `deferred` for a different reason than it used to be.** It waited
 * on A8; A8 landed, and `npm run eval -- --followup` now runs the real loop
 * through `runCycle` (`evals/loop.ts`) instead of imitating it. But the sweep
 * above runs **cycle 1**, and `08`'s `expected` is the answer to the proposal
 * in cycle 2 — so the sweep has no oracle for it and must not spend a call
 * pretending to. Scoring it in the sweep was tried and it *passed*, which is
 * the worst outcome available: cycle 1 happened to choose the venue the
 * fixture expects of cycle 2, so a meaningless verdict came out green. The
 * judgement is deferred to the follow-up table, which is the measurement that
 * exists — `blockedReason` says so, and `07`, whose whole subject had no
 * source in the product, was dropped rather than rewritten.
 *
 * ⚠️ **What `08` proves is the chain, not the discrimination.** It has two
 * candidate venues, and a `soft` rejection blocks the whole rejected one
 * (`blockedByRejections`) — so exactly one candidate is left and the agent
 * cannot answer wrongly. What passing means is that extraction, the
 * correction, the blocking, the re-run and the persistence all happened; it
 * is not evidence that a stated budget changed anybody's mind. A scenario
 * that measured *that* would need three or more survivors, only one of which
 * matches the stated preference — and it would need venues to carry the
 * preference at all, which nothing fetches
 * ([#139](https://github.com/ron14y-sys/squad_lock/issues/139)). The old
 * noise scenario had the same two-candidate shape and the same gap, with no
 * Places field that could ever close it, so it was dropped rather than
 * rewritten.
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

/**
 * Which missing stage, in the words the table prints.
 *
 * **Raises on a scored scenario** rather than naming a stage. It used to fall
 * back to "needs B6", which stayed in place after the trimming landed and
 * nothing was blocked on B6 any more — a fallback that is never reached is
 * also never noticed going stale. Asking why a scorable scenario is blocked is
 * a bug in the caller.
 */
export function blockedReason(scenario: Scenario): string {
  // Not a missing stage any more — a different table. See the note above.
  if (scenario.trap === "rejection-loop") return "judged under --followup";
  if (scenario.trap === "semantic-geography") return "needs A12";
  throw new Error(
    `judge: "${scenario.id}" is scored, not blocked — it has no missing stage`
  );
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
/**
 * Everything `judge` reads: a `MatchRunDraft` fresh from the agent, or a run
 * read back out of the database. The follow-up harness passes the second,
 * because what a participant is shown is the persisted row and not the draft
 * — a run that was answered correctly and written wrongly should not pass.
 */
export type JudgeableRun = {
  options: {
    rank: number;
    venue: { placeId: string | null; name: string };
    proposedDatetime: Date;
    proposedEnd: Date;
  }[];
};

export function judge(scenario: Scenario, draft: JudgeableRun): Verdict {
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

/* -------------------------------------------------------------------------
 * A7 — was the *constraint* right?
 * ---------------------------------------------------------------------- */

/**
 * One field's answer against the expected one. A list is a set — "bar, café"
 * and "café, bar" are the same request (#217) — so it is compared sorted.
 */
function sameAnswer(want: unknown, got: unknown): boolean {
  const key = (v: unknown) =>
    JSON.stringify(Array.isArray(v) ? [...v].sort() : v);
  return want !== undefined && key(want) === key(got);
}

/**
 * What a rejection is agreed to produce (#220). `distance` and `start` are
 * compared whole when given, and must be absent when not — a distance the
 * person never mentioned is as invented as a preference. `untranslated: true`
 * asks only that something was set aside, since its wording is the model's.
 */
export type ExpectedConstraint = {
  objection: ObjectionKind;
  softPreferences: TonightCorrection;
  distance?: DistanceRequest;
  start?: StartRequest;
  untranslated?: true;
};

/**
 * The extracted correction against the one we agreed on.
 *
 * **Set equality, never containment.** "The right field came out" and
 * "nothing else was invented" carry the same weight: an extra field is not a
 * near miss, it is a preference nobody stated, and it would change the next
 * ranking on its own ([#86](https://github.com/ron14y-sys/squad_lock/issues/86)).
 *
 * A separate verdict from `judge` above, and reported in its own table, for a
 * reason worth stating plainly: "the constraint is right" and "the proposal is
 * right" are two different claims, and only the second is what spec §12.5
 * counts.
 */
export function judgeConstraint(
  expected: ExpectedConstraint,
  got: ConstraintUpdate
): Verdict {
  if (got.objection !== expected.objection) {
    return {
      pass: false,
      reason: `objection "${got.objection}", expected "${expected.objection}"`,
    };
  }

  const wanted = expected.softPreferences as Record<string, unknown>;
  const whole = (field: string, want: unknown, value: unknown) =>
    want === undefined
      ? value === null || value === undefined
        ? []
        : [`invented ${field}=${JSON.stringify(value)}`]
      : sameAnswer(want, value)
        ? []
        : [
            `${field}=${JSON.stringify(value)}, expected ${JSON.stringify(want)}`,
          ];

  const differences = [
    ...Object.entries(got.softPreferences).flatMap(([field, value]) => {
      const want = wanted[field];
      if (sameAnswer(want, value)) return [];
      return [
        want === undefined
          ? `invented ${field}=${value}`
          : `${field}=${value}, expected ${want}`,
      ];
    }),
    ...Object.keys(wanted)
      .filter((field) => !(field in got.softPreferences))
      .map((field) => `missed ${field}`),
    ...whole("distance", expected.distance, got.distance),
    ...whole("start", expected.start, got.start),
    ...(expected.untranslated && !got.untranslated
      ? ["missed untranslated"]
      : []),
  ];

  return differences.length
    ? { pass: false, reason: differences.join("; ") }
    : { pass: true };
}

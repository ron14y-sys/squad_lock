# A5 — Eval runner: plan

**Task:** A5 ([tasks/todo.md](todo.md)) · **Depends on:** A4 (done) · **Waiting on:** B6, A7/A8
**Status:** built. See [docs/decisions/eval-runner.md](../docs/decisions/eval-runner.md).

> **Changed while building, 9 Sep 2026 — scenario `04` is blocked too.**
> The plan called it scored. The first live sweep failed it, and the scenario's
> own `expected.reasoning` explains why: _"a naive straight-line-only
> implementation is expected to get this one wrong; that gap is exactly what
> this scenario measures."_ The detour factor comes from **A12, the Context
> Resolver**, which does not exist. So `04` waits on a third missing stage, and
> counting it as a model failure would report a missing stage as a bad model.
> The eval answer was **not** touched — only its classification. Scored today
> is **three** scenarios, not four: `01`, `02`, `06`.

Two scope decisions were taken before this plan was written, and everything
below follows from them:

1. **We stay on the Gemini free tier.** 20 requests per day for
   `gemini-3.6-flash` (spec §6.4, §13 item 17). Quota is the scarcest thing
   this task has, so the design spends as little of it as possible.
2. **Scenarios 07 and 08 wait.** Their `expected` is the follow-up proposal
   _after_ a rejection, which needs A7 (constraint updater) and A8 (cycle
   loop). Neither exists. They are reported as deferred, never as failures.

---

## What each of the eight scenarios is worth today

| Scenario                      | State      | Why                                                     |
| ----------------------------- | ---------- | ------------------------------------------------------- |
| `01-hard-constraint-trap`     | **scored** | whole window survives; answer is a venue                |
| `02-closed-on-the-night-trap` | **scored** | the empty intersection is the trap, so B6 is not needed |
| `04-semantic-geography-trap`  | **scored** | whole window survives                                   |
| `06-no-perfect-solution-...`  | **scored** | whole window survives                                   |
| `03-mobility-window-trap`     | _blocked_  | `needsTrim` — without B6 the right pair is filtered out |
| `05-no-perfect-solution-diet` | _blocked_  | `needsTrim` — same                                      |
| `07-rejection-loop-noise`     | _deferred_ | needs A7 + A8; also `needsTrim`                         |
| `08-rejection-loop-budget`    | _deferred_ | needs A7 + A8                                           |

**Three scored scenarios means three API calls per full run** (four as first
planned, before `04` moved). That fits the free tier with room for six runs a
day, which is the budget this plan works inside.

`blocked` is derived by `needsTrim(scenario)`, which already exists in
[evals/adapter.ts](../evals/adapter.ts) and reads the fixture rather than a
hardcoded list. `deferred` is derived from `trap === "rejection-loop"`. Neither
is a list anybody has to maintain: when B6 lands, 03 and 05 become scored on
their own, and A5 needs no edit.

---

## The pieces to build

### 1. `evals/judge.ts` — is the answer _right_

Pure, deterministic, no model call, no quota. A4 already proves an answer is
_legal_; this is the first thing that proves it is _correct_.

```ts
judgeAnswer(scenario, draft): Verdict
```

- **Judges rank 1 only.** Ranks 2 and 3 are "we also considered"; the proposal
  is rank 1 and that is what §12 measures.
- **Matches the venue by `placeId`, never by name.** `expected.venue` is a
  name, so it is resolved through the scenario's own `candidateVenues` first.
  All eight resolve today. **A name that does not resolve raises** — that is a
  broken fixture, and it must not be able to look like a model failure.
- **Checks the time whenever `expected.time` is present** (03, 05, 07), against
  `proposedDatetime` and `proposedEnd`, converted with `instantOf`. An end at
  or before the start is the next day (07 runs to 00:00).
- Returns the reason and both sides on a failure, so a red row is readable
  without opening the raw JSON.

### 2. Independent violation count

The runner re-runs A2's `assertChosenPairAllowed` over **all three** options
itself, rather than trusting that the engine already did. It is free, it is the
one column the spec says must be zero, and a check that only ever runs inside
the thing it is checking is not a check.

A `HardConstraintError` from the engine counts as a violation too.

### 3. `evals/runner.ts` — orchestration and quota

- **Sequential, never parallel.** Rate limits, and a duration measured against
  three concurrent calls is not a duration.
- **Blocked and deferred scenarios cost no call.** They are classified before
  anything is sent, and print their reason. `--include-blocked` forces them
  when B6 lands or when somebody wants the number anyway.
- **A scenario filter:** `npm run eval 01 04` runs two. This is the everyday
  command; the full sweep is the occasional one.
- **Rate limiting.** `isRateLimited` and `retryDelayMs` already exist in
  [lib/llm/client.ts](../lib/llm/client.ts). On a rate-limited response: wait
  the delay the API itself asked for and retry once; if it happens again,
  **stop the sweep and print the partial table.** A partial result beats a
  crash, and burning the rest of the day's quota on retries helps nobody.
- **Every raw answer is recorded** to `evals/runs/<timestamp>/<id>.json`
  (gitignored), with the input it was given.

### 4. `--replay <dir>` — develop the judge without spending quota

Re-judges a recorded sweep through `interpretAnswer`, with zero calls. This is
the piece that makes the free tier workable: the judge, the table, the exit
code and the tests are all built and debugged against recorded answers, and
real quota is spent only on measurement.

### 5. The table

```
scenario                        verdict    venue           cost      dur    cycles  viol
01-hard-constraint-trap         PASS       Container       $0.0021   4.3s   1       0
02-closed-on-the-night-trap     PASS       Port Said       $0.0019   5.1s   1       0
04-semantic-geography-trap      FAIL       Bicicletta      $0.0024   3.9s   1       0
06-no-perfect-solution-...      PASS       Kfar Bat Yam    $0.0022   6.0s   1       0
03-mobility-window-trap         BLOCKED    needs B6        -         -      -       -
05-no-perfect-solution-diet     BLOCKED    needs B6        -         -      -       -
07-rejection-loop-noise         DEFERRED   needs A7/A8     -         -      -       -
08-rejection-loop-budget        DEFERRED   needs A7/A8     -         -      -       -

4 scored - 3 passed (75%) - 2 blocked (B6) - 2 deferred (A7/A8)
$0.0086 total - 19.3s - 0 hard-constraint violations
```

Two rules about this table:

- **The pass rate is over scored scenarios only, and the header says so.** A
  denominator that quietly includes six unscorable scenarios is a number that
  means nothing; one that quietly excludes them without saying so is worse.
- **`cycles` is 1 for every row and will stay 1 until A8.** It is printed
  honestly with a footnote rather than left out, because it is one of the five
  columns spec §12 asks for.

`costUsd` may be null for a model missing from the price table. It stays null
in the total — `describeTotal` in [lib/llm/cost.ts](../lib/llm/cost.ts) already
refuses to let an unknown become a zero, and the table follows it.

### 6. Exit code, and why this is not a CI gate

Exit non-zero on **a hard-constraint violation or a crash**, never on the pass
rate.

`npm run eval` is deliberately **not** wired into CI. It costs real requests on
a 20-per-day quota, and a model's judgement is not a thing to gate a pull
request on. Spec §12's "≥ 80% of scenarios" is a project target measured
deliberately, not an assertion run on every push. The invariant that _is_ hard
— zero hard-constraint violations — is the one the exit code enforces.

---

## Order of work

Each step lands green and is useful on its own.

1. `evals/judge.ts` + tests. No quota.
2. Classification (`scored` / `blocked` / `deferred`) + tests. No quota.
3. Runner skeleton with recording and `--replay`. One real call, on `01`, to
   produce the first recording to replay against.
4. Table, totals and exit code, built against that recording. No quota.
5. Wire `npm run eval`, then **one real full sweep** — four requests.
6. Docs: `docs/decisions/eval-runner.md`, the "What happens to these later"
   section of [evals/README.md](../evals/README.md), and A5 in
   [tasks/todo.md](todo.md) with the two deferrals recorded honestly.

## Tests, all of which run without a key

- Judge: correct venue passes; wrong venue fails; correct venue at the wrong
  time fails on a scenario carrying `expected.time`; an `expected.venue` absent
  from `candidateVenues` raises rather than failing.
- Classification: 03 and 05 are blocked, 07 and 08 deferred, the other four
  scored — asserted against the real fixtures, so a new scenario is classified
  by rule and not by hand.
- Violations: a fabricated illegal option is counted, and makes the exit code
  non-zero.
- Table: the pass rate divides by scored scenarios, and a null cost does not
  become a zero in the total.

## The rule this task must not break

**A5 never changes an eval answer because the engine disagrees with it.** An
answer changes only the way [#86](https://github.com/ron14y-sys/squad_lock/issues/86)'s
did — because it contradicted the rules in
[evals/README.md](../evals/README.md), agreed by all three. If `04` or `06`
fails, that failure is the result: it is input to A6 and A10, not a reason to
edit a fixture.

## Known, and accepted

- **Four real scored scenarios is a thin measurement**, and the plan says so
  rather than dressing it up. It becomes six when B6 lands and eight when A8
  does, with no change to the runner.
- **Spec §12's 20-second target stays open.** A4's single live run took ~45s.
  Four samples will not settle it either, but they are four more than there
  are now.
- The scenario dates sit in early September 2026. Nothing in the engine checks
  that a slot is in the future, so this does not affect a run.

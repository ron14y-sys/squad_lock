# A5 — Eval runner

**Task:** A5 ([tasks/todo.md](../../tasks/todo.md)) · **Plan:** [tasks/a5-plan.md](../../tasks/a5-plan.md) · **Inherits:** A4
**Status:** complete. `evals/judge.ts`, `evals/sweep.ts`, `scripts/run-evals.ts`, `__tests__/eval-judge.test.ts`, `__tests__/eval-sweep.test.ts`. The judge, the classification, the violation count, the pass rate, the cost total and the exit code are all tested with no key, plus live runs against a real model: every scenario that can be scored today has been measured, **5 of 5 passed**.

---

## What A5 is

`npm run eval` is the first thing in the repo that asks whether an answer is
**right**. A4 proves an answer is _legal_ — `assertChosenPairAllowed` re-tests
the pair it chose. Nothing before this read `scenario.expected`.

```
npm run eval                     # every scenario that can be scored today
npm run eval -- 01 04            # just those, by id or by number
npm run eval -- --replay <dir>   # re-judge a recorded sweep. No key, no quota
npm run eval -- --include-blocked
```

## The sweeps

**9 Sep 2026, before the trimming landed** — three scored, three passed, zero
violations, $0.0092, 12–23s per scenario. Five scenarios waited on a stage.

**9 Sep 2026, after the trimming landed**, `03` and `05` became scorable, and
the free tier ran out before they could be measured. **16 Sep 2026** measured
exactly those two — two requests, no retries — and nothing else:

| Scenario                               | Verdict      | Cost      | Time  | Measured |
| -------------------------------------- | ------------ | --------- | ----- | -------- |
| `01-hard-constraint-trap`              | **PASS**     | $0.002900 | 6.9s  | 9 Sep    |
| `02-closed-on-the-night-trap`          | **PASS**     | $0.002099 | 6.0s  | 9 Sep    |
| `03-mobility-window-trap`              | **PASS**     | $0.005292 | 8.1s  | 16 Sep   |
| `04-semantic-geography-trap`           | BLOCKED, A12 | —         | —     | —        |
| `05-no-perfect-solution-diet-conflict` | **PASS**     | $0.005666 | 11.9s | 16 Sep   |
| `06-no-perfect-solution-dispersed`     | **PASS**     | $0.005055 | 22.9s | 9 Sep    |
| `07`, `08`                             | DEFERRED     | —         | —     | —        |

**Five scored, five passed, zero hard-constraint violations. $0.021 in all.**

> ⚠️ **Measured with a hint, found 16 Sep 2026 (A6).** Every run above gave the
> model the scenario's `description` as its occasion, and that description
> explains the trap. Removed in [tasks/a6-plan.md](../../tasks/a6-plan.md).
> Re-measured without it the same day, where the hint could change the venue:
> **`03` PASS (11.7s), `05` PASS (10.2s), `06` PASS (12.1s), 0 violations,
> $0.016.** `01` and `02` each leave one legal pair, so no prompt can change
> their venue; they were not re-run.

Not one sweep, and it does not need to be. `01` and `02` ran under the trimmed
code on 9 Sep. `06`'s figure is from the first sweep and still counts: replaying
that recording under the trimmed code re-validates the answer, which proves the
model saw an identical input. Re-running any of the three would have spent
quota to learn nothing new.

**What `03` and `05` settled.** Before the run, the deterministic column already
showed both offering the agreed answer ranked **first** by leximin — `03`
Bicicletta at 20:00–23:00, `05` HaKosem Kerem at 19:30–22:30. Before the
trimming, `05`'s agreed answer was not on the list at all. What was untested is
whether the model would overrule leximin, and both carried a real temptation
to: the wrong option is the **longer evening** in both cases (`03` Herzl 16 at
18:00–23:00, `05` Nanuchka Kosher at 19:30–23:00), and in `05` it is better
rated as well (4.4 against 3.7). **It did not.** Both answers are the agreed
venue at the agreed hours, with the longer evening as rank 2 — the judge checks
the hours as well as the venue, so this is not a venue match alone.

**Durations, against spec §12's 20-second target:** 6.0s, 6.9s, 8.1s, 11.9s,
22.9s, and 12.2s/16.1s from the first sweep. One of seven samples is over. A4's
single earlier sample was ~45s, which now looks like the tail rather than the
middle.

**Five samples is still a thin measurement** — one run per scenario, with no
second run to show whether an answer is stable. It is what the free tier buys,
and it is stated here rather than rounded up into §12's "≥ 80%".

## What the sweeps taught the runner

Two defects in this file, both found by running it rather than by reading it:

1. **A transient overload was recorded as a model failure.** `isRateLimited`
   matches `quota|RESOURCE_EXHAUSTED|429`; the model's "currently experiencing
   high demand" contains none of them, so three scenarios were marked ERROR
   when the API had simply said "later". `isOverloaded` now sits beside it in
   `lib/llm/client.ts`, and `withRetries` waits an overload out.
2. **The pass rate counted scenarios that never produced an answer.** One run
   printed "4 scored · 1 passed (25%)" when 1 of 1 _attempted_ had passed. The
   denominator is now scenarios where an answer came back; the rest report as
   "no answer" and are named separately.

**And the binding limit is not the one the spec names.** §6.4 says 20 requests
a day; what actually stops a sweep is the **per-minute** window, well inside the
daily cap. The runner now paces calls (`EVAL_PACE_MS`, 20s) and waits out short
delays the API itself names — a rate limit that quotes a retry of 16s is this
tier's pace, while one quoting hours, or none at all, is a stop. That
distinction is what makes a free-tier sweep completable at all, and it is
evidence for §13 item 17 rather than an opinion about it.

## The decisions

### 1. Scenarios waiting on a stage are not failures, and one of them is not obvious

A wrong answer means one of two things — the model chose badly, or a stage that
would have made the right answer reachable does not exist. Reporting the second
as the first is the expensive kind of wrong: it blames a model for a hole in
the pipeline.

| Scenario   | Waiting on               | Because                                               |
| ---------- | ------------------------ | ----------------------------------------------------- |
| `04`       | **A12** Context Resolver | leximin on a bare straight line picks the other venue |
| `07`, `08` | **A7 + A8**              | `expected` is the proposal _after_ a rejection        |

There were five. `03` and `05` waited on the trimming — the meeting must shorten
to fit the venue — and became scored when it landed; both passed on 16 Sep.

`04` is the one worth naming, because it does not look like a missing stage.
The others produce an obviously absent or filtered answer; `04` produces a
**legal, plausible, wrong** one — Shapira Social, which is both nearer the
worst-off participant on a straight line and the better-rated venue. Its own
`expected.reasoning` says so outright: _"a naive straight-line-only
implementation is expected to get this one wrong; that gap is exactly what this
scenario measures."_ Without A12's detour factor there is nothing in the system
that could reach Rothschild 12.

**No eval answer was changed.** `04`'s classification moved; its `expected` did
not. That distinction is the rule in [evals/README.md](../../evals/README.md)
and it is the one this task could most easily have broken.

### 2. Classification is derived, never listed

`classify` reads `trap` and `needsTrim`, both of which are fixture data. A
hardcoded set of ids would be wrong the moment a scenario is added or a stage
lands — which is exactly the mistake `needsTrim`'s own comment records. When the
trimming landed, `03` and `05` became scored the same way; `04` does when A12
does.

### 3. The runner re-checks the constraints itself

`runMatchingAgent` already runs `assertChosenPairAllowed` on all three options.
The runner runs `checkChosenPair` over them again anyway. A check that only
ever runs inside the thing it is checking is not a check, this is the one
column spec §12 says must be zero, and A2 is pure — so it costs nothing.

### 4. `--replay` is what makes the free tier workable

Every answer is written to `evals/runs/<timestamp>/<id>.json` (gitignored).
`--replay <dir>` re-judges a recorded sweep through `interpretAnswer` with no
call at all.

20 requests a day (§6.4) is the binding constraint on this task. The judge, the
violation count, the table, the totals and the exit code were all built and
debugged against one recording; real quota was spent once, on measurement. It
is also how a failure gets diagnosed tomorrow without paying for it twice.

### 5. Wall clocks, not instants

`expected.time` is a wall clock somebody wrote in a fixture; `proposedDatetime`
is an instant. The judge formats the instant back into `APP_TIME_ZONE` and
compares strings, rather than converting the fixture forward. That removes the
date from the comparison entirely — `07`'s end at `00:00` is simply the next
midnight, formatted — and it is the shorter of the two directions.

### 6. Rank 1 only

Ranks 2 and 3 are "we also considered". The proposal is rank 1, and that is
what §12 measures. A test pins it: a draft whose rank 2 is the agreed answer
still fails.

### 7. Not a CI gate

`npm run eval` is deliberately not in `.github/workflows/ci.yml`. It spends
real requests against a 20-a-day quota, and a model's judgement is not a thing
to block a pull request on. §12's "≥ 80%" is a target measured deliberately.

The exit code enforces the one invariant that _is_ hard: non-zero on a
hard-constraint violation, or on an error. Never on the pass rate.

### 8. `cycles` is printed as 1, not omitted

Spec §12 asks for five columns and this is one of them. It will stay 1 until A8
spends a cycle. Printing it with a footnote is honest; leaving it out would
quietly drop a criterion.

## What A5 does not do

- **It does not judge `07` and `08` at all.** Their first proposal could be
  scored against `initialProposal`, but that is half a scenario, and the half
  that matters is the follow-up. Deferred until A7 and A8 exist.
- **It does not persist a run.** `persistMatchRun` needs a `Meeting` row, and
  no database exists in dev or CI (see A4's ⚠️). The eval path is deliberately
  database-free.
- **It does not wait out a daily quota.** A rate limit quoting a short delay
  (up to 90s) is the per-minute window and is waited out, as is an overload —
  at most three retries per scenario. One quoting hours, or no delay at all, is
  the daily cap: the sweep stops and prints the partial table. Burning the rest
  of the day's quota on retries helps nobody.

## What the next stage inherits

When A12 lands, the only work in A5 is deleting the `semantic-geography` line
from `classify`. When A7/A8 land, it is deleting the `rejection-loop` line and
teaching the runner to run a second cycle. The
judge, the table, the recording and the violation count are stage-agnostic.

> **Half of that happened, 24 Sep 2026.** A7 landed, and the runner does run a
> second cycle — `npm run eval -- --followup` extracts the constraint from what
> somebody wrote and asks the agent again, in its own table. Both rejection
> scenarios reach the agreed venue. The `rejection-loop` line in `classify`
> stays, though, and `07` and `08` stay `deferred`: that harness has no cap, no
> `stuck` and no persistence, so it is not the loop, and §12.5's pass rate may
> only carry the claim the product can make. **A8** is what deletes the line.
> `blockedReason` now says `needs A8`. See
> [constraint-updater.md](constraint-updater.md).

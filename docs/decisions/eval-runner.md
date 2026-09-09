# A5 — Eval runner

**Task:** A5 ([tasks/todo.md](../../tasks/todo.md)) · **Plan:** [tasks/a5-plan.md](../../tasks/a5-plan.md) · **Inherits:** A4
**Status:** complete. `evals/judge.ts`, `scripts/run-evals.ts`, `__tests__/eval-judge.test.ts`. 8 new tests, plus one live sweep against a real model.

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

## The first live sweep, 9 Sep 2026

```
scenario                             verdict   cost        dur      cycles  viol
hard-constraint-trap                 PASS      $0.002326   16.1s    1       0
closed-on-the-night-trap             PASS      $0.001866   12.2s    1       0
mobility-window-trap                 BLOCKED   —           —        —       0     needs B6
semantic-geography-trap              BLOCKED   —           —        —       0     needs A12
no-perfect-solution-diet-conflict    BLOCKED   —           —        —       0     needs B6
no-perfect-solution-dispersed-group  PASS      $0.005055   22.9s    1       0
rejection-loop-noise                 DEFERRED  —           —        —       0     needs A7/A8
rejection-loop-budget                DEFERRED  —           —        —       0     needs A7/A8

3 scored · 3 passed (100%) · 3 blocked (B6, A12) · 2 deferred (A7/A8)
$0.009247 · 51.2s · 0 hard-constraint violations
```

**Read the denominator, not the percentage.** Three of eight scenarios can be
scored today, and 100% of three is a thin measurement. It is also the first
real one there has been. Spec §12's target — ≥ 80% with zero violations — is
met on what can be measured, and five scenarios are waiting on three stages.

**Durations, against spec §12's 20-second target:** 12.2s, 16.1s, 22.9s. A4's
single sample was ~45s, which now looks like the tail rather than the middle.
Three samples do not settle it either, but F2's spread is starting to have
company.

## The decisions

### 1. Five scenarios are not failures, and one of them is not obvious

A wrong answer means one of two things — the model chose badly, or a stage that
would have made the right answer reachable does not exist. Reporting the second
as the first is the expensive kind of wrong: it blames a model for a hole in
the pipeline.

| Scenario   | Waiting on               | Because                                               |
| ---------- | ------------------------ | ----------------------------------------------------- |
| `03`, `05` | **B6**                   | the meeting must shorten to fit the venue             |
| `04`       | **A12** Context Resolver | leximin on a bare straight line picks the other venue |
| `07`, `08` | **A7 + A8**              | `expected` is the proposal _after_ a rejection        |

`04` is the one worth naming, because it does not look like a missing stage.
The other four produce an obviously absent or filtered answer; `04` produces a
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
lands — which is exactly the mistake `needsTrim`'s own comment records. When B6
ships, `03` and `05` become scored with no edit to A5. So does `04` when A12
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
- **It does not retry a rate limit more than the API asks for.** On
  `isRateLimited` it takes `retryDelayMs` at face value once, then stops the
  sweep and prints the partial table. Burning the rest of the day's quota on
  retries helps nobody.

## What the next stage inherits

When B6, A12 or A8 lands, the only work in A5 is deleting a line from
`classify` — and for A7/A8, teaching the runner to run a second cycle. The
judge, the table, the recording and the violation count are stage-agnostic.

# The Group Matching Agent — the one call, and everything that guards it

**Task:** A4 ([tasks/todo.md](../../tasks/todo.md)) · **Blocks:** A5 (eval runner), A6 (justification quality), A7/A8 (the rejection loop), B11 (which is what calls it), C6 (meeting screen)
**Status:** complete. `lib/matching/agent.ts`, `lib/matching/schemas.ts`, `lib/db/match-run.ts`, `evals/adapter.ts`. 58 new tests, plus one live run against a real model.

---

## What A4 is

The single point in SquadLock where a model **decides** something. Everything around it is deterministic:

| Stage                        | Owner | Decides                                       |
| ---------------------------- | ----- | --------------------------------------------- |
| A2 `filterPairs`             | code  | which `(venue, slot)` pairs are legal         |
| A3 `scoreCandidates`         | code  | how heavily each falls on each person         |
| **A4 `runMatchingAgent`**    | model | **which of the legal pairs is best, and why** |
| A2 `assertChosenPairAllowed` | code  | whether the answer is still legal             |
| `persistMatchRun`            | code  | writing the whole run down                    |

This is [spec §4.4](../spec.md) as code: _code narrows on what is true or false; the model decides among what is valid._

## The decisions

### 1. The model never writes the "ring ahead" warning

The demo script and the F2 spike both had an `unverified_note` field the model filled in. **Removed.** Whether a venue's opening hours were confirmed is a _fact_, and A2 already knows it exactly, per pair, in `ViablePair.unverified`. `describeUnverified` writes the sentence from those findings.

The model is still told `verified: true|false` per pair, because _preferring_ a checked venue is a judgement and that half is genuinely its job ([hard-constraints.md](hard-constraints.md)).

Why it matters: a model that forgot the sentence would cost somebody a wasted journey, and a model that invented one would send them to ring a restaurant whose hours we had confirmed. Neither is possible now.

### 2. The post-check runs on all three options, not just rank 1

Ranks 2 and 3 are persisted, surface in the timeline as "we also considered", and stay in the candidate pool for the next cycle (A8b). An illegal option in any of those three positions is an illegal option that reaches a user. So `assertChosenPairAllowed` runs three times.

### 3. Three options, unless there were not three pairs

`options.length` must equal `min(3, distinct viable pairs)`. Demanding three from a shortlist of two would fail a run whose answer was correct — which is exactly what happens on eval scenario `01`, where the hard-constraint filter leaves precisely one legal venue.

### 4. Three failure modes, three error types

| Error                 | Means                           | The fix                             |
| --------------------- | ------------------------------- | ----------------------------------- |
| `LlmTruncatedError`   | the answer was cut off (A1's)   | raise the cap or lower the thinking |
| `AgentAnswerError`    | the answer was the wrong shape  | the schema or the prompt            |
| `HardConstraintError` | well formed, and illegal (A2's) | a failed run, never a proposal      |

F2 lost an afternoon to the first two being indistinguishable. They are now three separate types with three separate messages, and the demo prints each differently.

### 5. A fabricated _person_ is A4's; a missing person is A6's

A justification addressed to somebody not in the meeting is rejected here — only an answer can get that wrong, and it is the same class of mistake as `not_a_candidate`. **Full coverage — every confirmed participant named on every option — is [A6](../../tasks/todo.md)**, along with its "5 of 6 is a failed run" test. A4 leaves that space deliberately empty rather than half-implementing it.

### 6. The prompt lives in one place

`scripts/demo-matching.ts` used to carry its own copy of the system prompt and the JSON Schema. It now calls `runMatchingAgent`. Two prompts meant to be one prompt drift the moment somebody edits the wrong file.

### 7. Four prompt lines are decisions, not style

Deleting any of them silently un-decides something:

- **"Do not second-guess the filter"** — §4.1b.
- **"A participant who stated no opinion has no opinion"** — [#86](https://github.com/ron14y-sys/squad_lock/issues/86) q5. Nothing deterministic reads `softPreferences` at all, so this obligation is the prompt's alone.
- **"Strongly prefer a verified pair"** — [hard-constraints.md](hard-constraints.md).
- **"Name a constraint, never a comparison"** — §5.6. `traded_away` is where the honest cost goes, and nobody is shown it.

### 8. Two new columns

`prisma/migrations/20260907120000_a4_match_run_cost_and_unverified_note`, both nullable and additive:

- **`MatchRun.model / thinkingLevel / durationMs / inputTokens / outputTokens / thoughtTokens / cachedTokens / costUsd / costBasis`** — [llm-client.md](llm-client.md) recorded that these belong with whatever creates a run. `costUsd` is `NULL`, never `0`, for an unpriced model; `costBasis` says how far to trust it.
- **`MatchOption.unverified`** — what A2 could not check, as the structured `UnverifiedFact[]`. The exact opposite of `tradeoffs`: this one is shown to everybody.

  **The fact is stored; the sentence is rendered.** The app is `lang="he" dir="rtl"`, and `lib/format/hebrew-labels.ts` is where a stored English literal becomes Hebrew at display time — the rule `WEEKDAY_LABELS` already follows. The first version of this column held the rendered English sentence, which would have turned every historical row into a translation problem the day a Hebrew screen rendered it. `unverifiedNote(facts)` in that file produces the line the group actually reads.

⚠️ **The migration has not been applied to any database.** There is none to apply it to locally — see the gap below.

## What was measured

One live run, eval scenario `01-hard-constraint-trap`, `gemini-3.6-flash` at `low`:

- It reached **Container**, the scenario's agreed answer, having never been shown Toto — the higher-rated, closer venue the filter dropped for Dana's kosher requirement.
- It justified **all three** participants.
- **~45 seconds** wall clock. F2's median for this configuration was 4.7s and its worst local sample 42.5s, so this is at the bad end of F2's spread rather than outside it. **One sample, not a measurement** — A5 is what turns it into one, and spec §12's 20-second target is still an open question (F2 said the same).

## What A5 inherits

Everything below already exists and does not need rebuilding.

**Ready to use:**

| Thing                                  | Where                   | Notes                                                                       |
| -------------------------------------- | ----------------------- | --------------------------------------------------------------------------- |
| `loadScenarios()` / `loadScenario(id)` | `evals/adapter.ts`      | Typed `Scenario`, read from `evals/scenarios/`                              |
| `scenarioAgentInput(scenario)`         | `evals/adapter.ts`      | Runs A2 and A3 for real and returns a complete `MatchAgentInput`            |
| `instantOf(date, time)`                | `evals/adapter.ts`      | Wall clock → instant, DST-correct; the only such converter in the repo      |
| `needsTrim(scenario)`                  | `evals/adapter.ts`      | Whether B6's absence makes this scenario unscorable                         |
| `runMatchingAgent(input)`              | `lib/matching/agent.ts` | Returns `{ draft, call }` — `call` has tokens, ms, dollars and the raw JSON |
| `interpretAnswer(text, input)`         | `lib/matching/agent.ts` | The whole validation path with no call — for replaying a recorded answer    |
| `toMatchRunCreate` / `persistMatchRun` | `lib/db/match-run.ts`   | Cost columns included                                                       |
| `totalCost` / `describeTotal`          | `lib/llm/cost.ts`       | Totals without letting an unknown become a zero                             |

**The four things A5 still has to build:**

1. **The runner itself** — `npm run eval`, printing pass rate, cost, duration, cycles and hard-constraint violations per scenario. The violations column must be zero.
2. **Judging an answer.** A4 checks that an answer is _legal_; nothing yet checks it is _right_. `scenario.expected.venue` is the oracle, and `expected.time` matters wherever a window is narrowed.
3. **Rate limiting.** `gemini-3.6-flash` allows **20 requests per day** free (§6.4), and eight scenarios with a rejection loop each will exceed that. `isRateLimited` and `retryDelayMs` in `lib/llm/client.ts` exist for this; a full sweep probably needs the paid tier, and that is a decision, not an implementation detail.
4. **A verdict for the scenarios that need B6** — see the gap below.

**What A5 must not do:** change an eval answer because the engine disagrees with it. An answer changes only the way #86's did — because it contradicted the rules in `evals/README.md`, agreed by all three.

## Where A4 meets B5, which is already built

B5, B5b and B5c merged on 7 Sep 2026, while A4 was being written. They do not
overlap — A4 produces runs, B5 owns meetings — and the seam is worth stating
because **nothing joins them yet.**

**The contract:** `persistMatchRun(draft, call?, client?)` writes a `MatchRun`
and its `MatchOption` rows in one nested create. `MatchRun.meetingId` is a
foreign key, so a `Meeting` row must exist first — `initiateMeeting` in
[`lib/db/meetings.ts`](../../lib/db/meetings.ts) is what creates one.
`MatchRun` is uniquely keyed on `(meetingId, cycleNumber)`, so recording the
same weighing twice raises rather than producing two histories of one cycle.

**Three fields A4 never touches, and B5 already owns:**

- **`Meeting.status`** — a run does not decide a meeting is `awaiting`.
  `respondToMeeting` does.
- **`Meeting.cycleCount`** — A4 receives `cycleNumber` as input and increments
  nothing. B5 spends the cycle and flips to `stuck` at the cap.
- **`Meeting.currentDatetime`** — `initiateMeeting` deliberately leaves it
  unset, because turning a pinned wall-clock time into an instant needs the
  `APP_TIME_ZONE` conversion and no B5 criterion exercised it. **A4 makes this
  cheap:** the rank-1 option's `proposedDatetime` is already an instant, so
  whoever accepts a run into a meeting can simply copy it. Until somebody
  does, B5b's conflict query has nothing to find — it filters on
  `currentDatetime: { not: null }`.

**The missing wire is B11.** `respondToMeeting` spends a cycle and stops; it
does not re-run the match. B11 is where `runMatchingAgent` and
`persistMatchRun` get called, after the ~90-second batching window closes.

**Two things worth knowing when that wire is built:**

- **`MatchOption.unverified` is user-facing** — C6 renders it with an asterisk,
  through `unverifiedNote` in `lib/format/hebrew-labels.ts`, which is what turns
  the stored fact into the Hebrew sentence. `tradeoffs` on the same row is the
  opposite — persisted for the timeline and the report, never shown to the
  person who bore the cost (§5.6). Do not put them on the same line of a screen.
- **An empty viable set is not a run.** `runMatchingAgent` refuses to make a
  call when nothing survived the filter, because that is `stuck` and the group
  is owed a reason (§5.4). B5 already has a `stuck` status for it to land in.

## Two things B6 would otherwise have broken

Both were found by review before B6 exists, and both are fixed here because
each is one line now and a migration or a backfill later.

### The slot lookup reads the list the prompt was built from

The payload advertises `slotId(pair.slot)` from `input.viable`; an earlier
version looked the answer back up in a separate `input.slots` holding the
group's raw availability. The two held the same values, so nothing failed —
but nothing made them agree, and B6 is exactly the change that separates them.
Once a slot is trimmed to a venue's opening hours the trimmed window is in
`viable` and not in the group's free window, so every option would have been
rejected as _"a slot that was not offered"_ — blaming the model for a time the
code itself put in the prompt, which is the most misleading symptom available.

`MatchAgentInput.slots` is therefore **gone**: the offered slots are derived
from `viable`, so the two lists cannot disagree because there is only one.
`agent.test.ts` covers it with a pair whose slot is narrower than the group's
window — the shape B6 will produce.

### An option stores when it ends

`MatchOption.proposedEnd` and the `match_options` column behind it. B6's whole
purpose is that a meeting shortens to fit a venue, which makes the end a real
answer rather than one implied by the group's window: eval scenario `07`'s
expected answer is "until midnight, because the bar shuts", and A5 has to
compare against it. Adding the column now costs one line on an empty table;
adding it after real runs exist is a backfill nobody can compute, because the
venues' hours will have moved on.

## The gaps, stated plainly

**1. No database exists in dev or CI.** B1 provisioned Supabase and set `DATABASE_URL` on Vercel only; no local `.env.local` carries it and `.github/workflows/ci.yml` has no service container. Consequences:

- The migration in this change **has not been applied anywhere.** Someone with the connection string runs `npm run db:migrate:deploy`.
- `__tests__/match-run-db.test.ts` is written and **skips itself with a printed reason.** It starts working the moment a `DATABASE_URL` exists — `DATABASE_URL=… npx vitest run __tests__/match-run-db.test.ts`.
- The decisions all live in `toMatchRunCreate`, which is pure and has 13 tests. The impure half is four lines.

**2. B6 does not exist, so a meeting cannot shorten to fit a venue.** `evals/adapter.ts` produces the group's whole free window as the slot, and A2 then drops any pair the venue cannot cover entirely. That is the right answer for `02` (shut all evening) and the wrong one for `03`, `05` and `07`, where the meeting is supposed to shorten rather than vanish — in `05` and `07` the expected venue is not even in the viable set. `needsTrim(scenario)` derives this from the fixture rather than listing ids, so a new scenario is covered without an edit; `__tests__/eval-agent.test.ts` reports rather than asserts on those three. **A5 cannot publish a fair pass rate until B6 lands.**

The first version of that check _was_ a hardcoded list, and it named only two of the three. It was wrong on the day it was written and the suite stayed green, because a different venue survived in `07` — which is the failure mode an eval must not have.

**3. No rejection history in the payload.** A7 extracts a constraint from a rejection and A8 loops; neither exists. Rather than adding an optional field nothing fills — _a build step nothing exercises yet is not working, it is merely untested_ (AGENTS.md) — A4 leaves it out entirely. A7 adds it to `MatchAgentInput` and to the prompt together.

**4. A6's coverage check is not written.** See decision 5.

## How A4 was verified

- `npm run verify` — format, lint, `tsc --noEmit`, 320 tests passing.
- 34 tests in `lib/matching/agent.test.ts`, every one against a hand-written answer with no key and no network, including the answers a model should never produce.
- 13 tests in `lib/db/match-run.test.ts` over the row mapping.
- 11 tests in `__tests__/eval-agent.test.ts` running the adapter, A2 and A3 over all eight scenarios with no model involved.
- One live run, `EVAL_LIVE=1 npx vitest run __tests__/eval-agent.test.ts` — see "What was measured".
- `npm run demo` and `npm run demo -- --offline`, which now drive the real agent rather than a copy of it.

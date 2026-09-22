# A7 — Constraint Updater: free-text rejection → structured constraint: plan

**Task:** A7 ([tasks/todo.md](todo.md), [#15](https://github.com/ron14y-sys/squad_lock/issues/15)) · **Depends on:** A1 (the client), A4 (the agent), A6 (the justification rules), B5 (the rejection is already stored) · **Hands over to:** A8 (the loop), A8b (the blocked pair), A12 (its twin), B11 (assembles the run), C6 (shows the timeline)
**Status:** planned, not built. Branch `feat/a7-constraint-updater`.

This is the project's central mechanism ([spec §2.2.1](../docs/spec.md)): "this place isn't to my
taste" is not a button. Everything else in Track A exists so that this component has something to
correct.

---

## The binding constraint on this task

**Every change is written in the most minimal form that does the job.** No speculative
abstraction, no refactoring of adjacent code, and no field, helper or file without a caller in the
same change — the repo's own rule that _a build step nothing exercises yet is not working, it is
merely untested_ ([AGENTS.md](../AGENTS.md)), applied ahead of time rather than in review.

Where this plan deliberately asks for more than the minimum, it says so and gives the reason. That
happens exactly once, in step 7.

---

## Decisions, settled 22 Sep 2026

| #   | Question                                    | Decided                                                                                                     | Why                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | What may A7 return?                         | The closed `SoftPreferences` vocabulary, plus one `objection` classification                                | A field comparison rather than a translation ([#86](https://github.com/ron14y-sys/squad_lock/issues/86)). The classification is what distinguishes "no reason given" from "the reason was distance, which is A12's job"                                                                                                                                                                                              |
| 2   | What happens when nothing can be extracted? | A new run happens anyway: the rejected pair is blocked (A8b) and the **verbatim** text goes to A4           | D9 — a pre-computed rank cannot address an objection it never saw. [§4.1a](../docs/spec.md) permits free text at the human boundary, so the stronger model reads the words even when the extractor found no field. Serving a stored rank 2 was considered and rejected: it is a snapshot of a roster and a set of burdens that may have moved, and it breaks A6's coverage check when somebody has since dropped out |
| 3   | Who adds the column?                        | A7 — schema, migration and the write                                                                        | Otherwise A7 is a function nobody calls. B11 inherits the column rather than owning it                                                                                                                                                                                                                                                                                                                               |
| 4   | When does A7 run?                           | Immediately after `respondToMeeting`'s transaction commits, in the same request                             | An LLM call inside `prisma.$transaction` holds a connection for up to 60s. Batching, if any, is A8's question                                                                                                                                                                                                                                                                                                        |
| 5   | What happens when the call fails?           | Fall back to exactly the pre-A7 behaviour, and record the outcome as a fact                                 | By then the rejection is committed and the cycle is spent, so failing the request would make the person press again and spend a second cycle. Silence is worse: the product's whole claim is that it listened. Same rule as A13                                                                                                                                                                                      |
| 6   | How does the correction reach A4?           | Two separate fields in the payload — the standing preferences, and tonight's corrections with a short quote | Success criterion 4 asks for a proposal that **visibly** addresses the stated reason. A silent field-wise merge leaves the model nothing to point at                                                                                                                                                                                                                                                                 |
| 7   | What does A7 see?                           | The rejection text and the rejected option (name, neighbourhood, its soft facts, the slot)                  | Enough to tell what "too loud" refers to. Never the candidate list: a component that sees candidates is choosing a venue ([§4.1f](../docs/spec.md))                                                                                                                                                                                                                                                                  |
| 8   | How is A7 measured before A8 exists?        | A separate constraint-only judge and its own table                                                          | Otherwise the central component has no number until two tasks from now. A separate table because "the right constraint" and "the right proposal" are two meanings of "pass", and §12.5's number may only carry the second                                                                                                                                                                                            |
| 9   | Which model?                                | `gemini-3.5-flash-lite`, per [spec §6.4](../docs/spec.md) and [lib/llm/client.ts](../lib/llm/client.ts)     | A second provider is a new external dependency ("ask first", §10) and a second price table. `todo.md` and issue #15 still say "Haiku 4.5" from before the 2026-08-26 provider change; both are corrected in step 8                                                                                                                                                                                                   |
| 10  | Where does the code live?                   | `lib/extraction/`, one file                                                                                 | A12 is the twin and runs **before** the search, so `lib/matching/` would be the wrong home for it (D7). One file, not a folder of conventions — the shared conventions get extracted when there is a second caller, not before                                                                                                                                                                                       |

---

## What A7 builds

### Step 1 — the schema (one migration, two columns)

- **`ParticipantMeetingContext.softPreferences Json?`** — where a correction lands. `null` means
  no correction; `{}` would mean "corrected to nothing", which is not a state anyone can be in.
  The type and that distinction already exist in
  [lib/types/meeting.ts](../lib/types/meeting.ts) and in `evals/adapter.ts`.
- **`Response.extractionOutcome`** — a Prisma enum, nullable: `soft` · `distance` · `time` ·
  `venue_identity` · `none` · `failed_quota` · `failed_timeout` · `failed_invalid`. `null` means
  nothing was attempted (approve, "I can't make it", an amendment).

**One column, not two.** What was extracted and why nothing was are mutually exclusive, so one
closed set answers both. An enum rather than a free string, because `__tests__/types.test.ts`
type-checks this repo's enums against the generated client and a string drifts in silence.

⚠️ **There is still no database in dev or in CI.** This migration joins A4's unapplied one; whoever
holds the connection string runs `npm run db:migrate:deploy` for both.

### Step 2 — the updater: `lib/extraction/constraint-updater.ts`

One file, mirroring A4's split so that every check is testable with no key and no quota:

- `CONSTRAINT_UPDATE_JSON_SCHEMA` (loose, over the wire) and a Zod schema (strict, on the way in),
  written twice for the reason [lib/matching/schemas.ts](../lib/matching/schemas.ts) gives.
  `snake_case` on the wire marks the boundary.
- `SYSTEM_PROMPT`, whose rules are each a decision and not a style preference:
  - Return **only** what the person actually said. An absent field is not an opinion (#86).
  - Never name a venue, never choose one, never return a distance ([§4.1f](../docs/spec.md)).
  - When nothing in the text maps to the vocabulary, return `none` — that is an answer.
  - Classify the objection, so a distance complaint is recorded as one rather than forced into a
    soft field it does not fit.
- `buildPayload` — the rejection text, and the rejected option: name, neighbourhood, its
  `VenueSoftFacts`, the slot in words. **Not** the candidate list (decision 7), and **not** the
  person's own profile: the profile is the thing a correction overrides, and showing it to the
  model invites it to echo what is already there.
- `runConstraintUpdater(input)` — `generate({ task: "extraction" })`, non-streaming.
- `interpretUpdate(text)` — separate, so fabricated answers can be tested directly. One error
  class, the mirror of `AgentAnswerError`.

### Step 3 — the call site

In `app/api/meetings/[id]/respond/route.ts`, **after**
`respondToMeeting` returns, and only when the response was `doesnt_suit` with non-empty text.

On any failure — call, timeout, truncation, failed validation — the outcome is recorded and the
route returns its normal response. The API's response shape does not change: nothing on screen
reads this yet.

### Step 4 — persistence, and the two things it would otherwise break

One function in the existing [lib/db/meetings.ts](../lib/db/meetings.ts): append the
`ParticipantMeetingContext` row and set `Response.extractionOutcome`, in one transaction.

Two bugs this step has to avoid, both found while planning:

1. **A correction row must not spend somebody's free amendment.** `respondToMeeting` counts
   `participantMeetingContext.count({ meetingId, userId })` to decide whether an amendment is the
   free one (spec §3.1). A correction row appended by A7 would inflate that count and silently
   charge a cycle for the person's first real amendment. The count is narrowed to rows where
   `softPreferences` is null — no new column, one clause.
2. **Reading the context back is field-wise, not row-wise.** Rows append rather than overwrite, and
   an A7 row carries a correction with no origin while an amendment row carries an origin with no
   correction. Whoever assembles `Participant` (B11) resolves **each field from the latest row that
   has it**, not from the latest row. Written down here because A7 creates the first row that is
   not an amendment.

> **Steps 3 and 4 merged while building, 22 Sep 2026.** They are one unit, not
> two: the call site needs the option that was rejected, which is a row in the
> latest `MatchRun`, and the answer needs a row to land in. Built separately,
> step 3 would have been a call whose result goes nowhere — the thing the
> minimality rule at the top of this plan exists to prevent. `applyRejection`
> in [lib/extraction/apply-rejection.ts](../lib/extraction/apply-rejection.ts)
> is the seam where the pure updater and the database meet, and the only
> place they do.
>
> **Two things the venue snapshot cannot give us.** `MatchOption` stores a
> name, an address and coordinates; it has no neighbourhood, and
> `VenueSoftFacts` has no column anywhere in the schema — B7 is what produces
> them. So the payload sends both as absent rather than inventing them. In the
> eval path they are present, because a fixture states them, which is where
> "too loud" can actually be read against a venue marked `lively`.

### Step 5 — A4 sees the correction

In [lib/matching/agent.ts](../lib/matching/agent.ts), which
[docs/decisions/matching-agent.md](../docs/decisions/matching-agent.md) decision 3 already assigns
to A7:

- `buildPayload` gains `tonight_corrections` per person: the corrected fields, and a short quote of
  what they wrote. `stated_preferences` stays exactly as it is, beside it.
- Two prompt lines: a correction outranks the standing preference **for tonight**, and a person's
  correction is mentioned only in that person's own justification — the same privacy rule A6
  already applies to dietary needs and lost travel modes.

**No merge function is written.** Nothing deterministic branches on soft preferences, and decision
6 shows the model both layers rather than pre-applying §5.7's precedence — so there is nothing to
merge and nothing to test.

⚠️ **No live caller until A8.** The change is exercised by a `buildPayload` unit test, and by
step 7 if it is taken.

### Step 6 — measurement

- **Negative fixtures**, in their own small file: they need a text and an expected outcome, not
  venues or calendars. "לא בא לי, לא יודע להסביר" → `none` · "רחוק לי מדי" → `distance` with no
  soft field · "יקר וגם רועש" → two fields · "היה לי שם מקרה לא נעים" → `venue_identity`. The two
  existing rejection scenarios both land squarely on a field that exists, so they measure only the
  easy case.
- **`judgeConstraint`** in [evals/judge.ts](../evals/judge.ts): **set equality** on the extracted
  fields, not containment — "nothing extra was invented" carries the same weight as "the right
  field came out" (#86) — plus the objection classification.
- **Its own table**, run behind a flag: rejection · expected · got · match · ms · cost. `classify`
  keeps returning `deferred` for `07` and `08` in the main table; `blockedReason` becomes
  "needs A8".
- **Three runs each, with an agreement column.** `gemini-3.5-flash-lite` at `low` spends zero
  thought tokens and answered in 4.6–5.6s in [F2](../docs/decisions/runtime-budget.md), and its
  daily allowance is well above the matching model's 20. A5 could not afford a stability check;
  this stage can, and A5's open ⚠️ asks for one.

### Step 7 — one corrected cycle, in the eval harness only

**This is the one place this plan asks for more than the minimum.**

About twenty lines in the eval runner: apply the extracted correction to the participant, block the
rejected pair, call A4 once more. It is not the loop — no cap, no `stuck`, no persistence — and A8
replaces it.

**Why it is worth it:** it is the only thing that demonstrates success criterion 4 — _"a free-text
rejection produces a materially different next proposal that visibly addresses the stated reason"_
— before A8 exists. Without it, `07` and `08` stay deferred and the central mechanism is reported
on by its extraction alone. Cost is two matching calls.

**If it is dropped**, step 6 is the whole measurement and the plan is otherwise unchanged.

### Step 8 — docs

- Correct "Haiku 4.5" to `gemini-3.5-flash-lite` in [todo.md](todo.md) and in issue #15 — both
  predate the 2026-08-26 provider change (spec §6.4).
- `docs/decisions/constraint-updater.md`: the ten decisions above, and what A8, A12, B11 and C6
  inherit.
- Check off A7; note on B11 that the column and the write already exist.

---

## Tests, all with no key and no quota

Against fabricated answers, the way A4's are ([spec §9](../docs/spec.md): the LLM layers are tested
at their guard rails, not at the model):

- A value outside the vocabulary, a field that does not exist, and a JSON fragment are each
  rejected with the error that names the cause.
- `none` is accepted as an answer, not treated as a failure.
- A payload built for a rejection carries the rejected option and **not** the candidate list.
- `buildPayload` in A4 carries `tonight_corrections` beside `stated_preferences`, with both
  present.
- The amendment count ignores correction rows (step 4, bug 1).

---

## Deliberately not in A7

| Left out                                                               | Owner                                                                      |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Re-running the match, the cap, `stuck`                                 | A8                                                                         |
| Carrying ranks 2–3 forward; refusing to re-propose the rejected option | A8b                                                                        |
| Counting a cycle per re-weighing rather than per complaint             | [#125](https://github.com/ron14y-sys/squad_lock/issues/125), decided in A8 |
| Corrections about distance or time, beyond classifying them            | A12                                                                        |
| The batching window, and who assembles a run                           | B11                                                                        |
| Showing any of this on the timeline                                    | C6                                                                         |
| Retries and backoff on a failed call                                   | B9                                                                         |

---

## Verifying against a real database

Nothing below can be checked before `DATABASE_URL` points at a live Postgres.
As of 22 Sep 2026 it does not: `/api/health` answers `tenant/user
postgres.ddwhvsjupcuqxarztawt not found`, which is the Supabase project behind
that connection string being paused or gone, and `.env.local` has no
`DATABASE_URL` at all. B1 ([#21](https://github.com/ron14y-sys/squad_lock/issues/21))
was closed with this working, so this is a regression in the environment and
not in the code.

**First, apply what is waiting.** Two migrations have never run anywhere —
A4's and A7's:

```
npx prisma migrate status
npm run db:migrate:deploy
curl -s https://squadlock.vercel.app/api/health
```

**Then the six things a unit test cannot reach**, in order of how expensive
they are to get wrong:

| #   | Check                                                                                                                                                    | Why it needs a real database                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A correction row does **not** spend somebody's free amendment: write a correction for a user, then have that user amend, and the amendment is still free | The fix is a `Prisma.DbNull` filter on a JSON column, and Prisma's JSON-null semantics are exactly the kind of thing that is right in the type system and wrong against Postgres |
| 2   | The correction and the outcome land together, or neither does                                                                                            | `recordRejectionOutcome` is one `$transaction`; nothing here forces a failure partway through, so the claim rests on reading the code — the same gap B5c carries                 |
| 3   | A second correction from the same person **appends** a second row                                                                                        | The timeline has to say which objection triggered which re-weighing (spec §5.7)                                                                                                  |
| 4   | `findRejectedOption` returns rank 1 of the **latest** run, with two runs on one meeting                                                                  | Ordering by `cycleNumber desc` is trivial to write and trivial to get backwards                                                                                                  |
| 5   | The route path end to end: reject with text → a row and an outcome                                                                                       | Needs a `MatchRun` to exist, which needs B11 — or a seeded run, which is the cheaper way to check this before B11 lands                                                          |
| 6   | A failed extraction still returns a normal response, and records why                                                                                     | The failure path is the one nobody exercises by accident                                                                                                                         |

Checks 1–4 need a handful of rows and no model call. A small seed script is the
honest way to run them before B11 exists; it is not written yet, and it is not
part of A7 unless the database returns first.

## Known risks

- **The write path cannot be tested here.** No test in this repo touches a real database, so step
  4's transaction is checked by reading it — the same gap B5 and B5c already carry.
- **Hebrew extraction on a lite model is unmeasured.** Step 6 is what turns that into a number; if
  it is poor, A10 is where a stronger model is measured against it, not a second provider.
- **`objection` has one consumer at birth** — the stored outcome and the constraint judge. Its
  second is C6's timeline. If that still feels thin when the code is written, the honest move is to
  drop the field rather than ship it unread.

---

## Verify

- `07` extracts `noiseLevel: "quiet"` for Shani and nothing else; `08` extracts `budget: "modest"`
  for Oren and nothing else.
- A vague rejection extracts nothing, records `none`, and still produces a next run.
- A failed call records its cause and does not fail the response.
- A correction never charges somebody their free amendment.
- `npm run verify` passes.

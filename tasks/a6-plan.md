# A6 — Per-participant justification quality: plan

**Task:** A6 ([tasks/todo.md](todo.md)) · **Depends on:** A4 (done) · **Hands over to:** B11 (decides who is "confirmed"), C6 (shows the justification)
**Status:** part 2 (the research follow-up) is being built first; part 1 after it.

Two decisions were taken before this plan was written (16 Sep 2026):

1. **Coverage is enforced in code. "No comparison" is enforced by the prompt.**
   An answer that leaves somebody out is rejected. An explanation that
   compares ("twenty minutes worse for you than…") is forbidden by the prompt
   only. There is no banned-word list: it would reject good answers, and there
   is no retry, so a rejected answer is a failed run.
2. **A "same sentence for everyone" answer gets researched before anything is
   decided.** The research is part 2 below.

---

## Part 1 — what A6 builds

### 1. The coverage check

In `validateOptions` ([lib/matching/agent.ts](../lib/matching/agent.ts)), next
to A4's "not in this meeting" check, which is its mirror:

- **Every option names every participant in `input.participants`.** All three
  ranks, not only rank 1: ranks 2 and 3 are saved, shown as "we also
  considered", and carried into the next cycle by A8b.
- **The error names who is missing and on which rank**, e.g.
  `rank 2 has no justification for "u-eyal"`. It throws `AgentAnswerError`,
  because the answer has the wrong shape. It is not a hard-constraint problem.
- **Who counts as "confirmed" is not decided here.** `MatchAgentInput.participants`
  is already documented as "confirmed participants". Choosing them (for
  example, leaving out whoever said "I can't make it") is B11's job, since
  B11 builds the input. A6 checks the answer against the list it is given.

### 2. Tests, all with no key and no quota

In [lib/matching/agent.test.ts](../lib/matching/agent.test.ts):

- **The test the plan names: 5 of 6 is rejected.** A six-person input, and an
  answer that explains itself to five of them. The existing fixtures have two
  people, so this test builds its own six.
- **One row in the existing `it.each` rejection table:** two people, one
  missing. The table's own comment already leaves room for this row.
- **A person missing only on rank 3 is still rejected.**
- **All six covered is accepted.** This keeps the check from being too strict.

### 3. The trade-off never reaches the screen

`traded_away` is saved to `MatchOption.tradeoffs`, and no screen reads it
today. Nothing keeps it that way. A type-level test on `ProposalDTO` in
[lib/db/meeting-detail.ts](../lib/db/meeting-detail.ts) will fail if a
trade-off field is ever added to what the meeting screen receives.
`getMeetingDetail` itself needs a database, so it cannot be unit-tested here
(there is no database in dev or CI).

### 4. Docs

- [docs/decisions/matching-agent.md](../docs/decisions/matching-agent.md):
  decision 5 and gap 4 ("A6's coverage check is not written").
- The comment on `justifications` in
  [lib/matching/schemas.ts](../lib/matching/schemas.ts), which points at A6.
- A6 in [tasks/todo.md](todo.md).

**Part 1 needs no live call.** Everything is tested against hand-written answers.

---

## Part 2 — research: why some people got the same sentence

### The question

In two recorded eval runs of scenario `02`, all three participants got exactly
the same explanation. In the `05` run, three of four did. Real people almost
never have the same data, so the same sentence for everyone looks wrong.

### How the explanations are made today

- **Yes, AI writes them fresh on every run.** One call to the matching model
  (`gemini-3.6-flash`, thinking `low`) returns the three options, and each
  explanation is free text the model wrote. There is no template. The two
  runs of `02` prove it: same data, different wording ("a quick 1 km trip…"
  and "a very short journey…").
- **What the model is told about each person** (`buildPayload`): name,
  neighbourhood, `tolerance_km`, and any stated soft preferences. For each
  (venue, time) pair it also gets each person's burden number, plus the
  venue's name, neighbourhood, rating and soft facts.
- **What the model is not told:** hard constraints (kosher, vegan, allergies),
  recurring mobility rules ("no car on Wednesdays 18–20"), the per-meeting
  amendment, and anything from the calendar. The filter already used all of
  these to decide which pairs are allowed. The model only sees the result.

### What the recordings show

All 8 recorded answers (`evals/runs/`, 9 and 16 Sep):

| Run                         | Distinct explanations | Why                                                                                                             |
| --------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------- |
| `02` closed-on-the-night ×2 | **1 of 3**            | Noa, Itai and Roni are identical in every field the model sees: same neighbourhood, tolerance 5, no preferences |
| `05` diet-conflict          | **2 of 4**            | Adi, Noam and Eyal look identical to the model. Hila, the only one with a preference, got her own sentence      |
| `01` hard-constraint ×2     | 3 of 3                | Different wording, same content. Dana's kosher need is never mentioned: the model does not know about it        |
| `03`, `04`, `06`            | 3 of 3                | People differ in neighbourhood or tolerance, so the explanations differ                                         |

**Finding 1: the model tells people apart exactly as far as its data lets it.**
In `02` the three people really are the same person three times, so one
sentence is the honest answer. The eval scenarios clone people on purpose, so
that each one tests a single trap. That makes the repeated sentence partly a
side effect of the scenario files.

**Finding 2: part of the problem is real.** In `05`, Adi needs kosher and Noam
needs a vegan option. The chosen venue meets both needs, and that is exactly
what each of them would want to hear. The model could not say it, because it
was never told. The prompt's own example ("they take the allergy seriously")
mentions a fact the model is never given.

**Finding 3: when the data is thin, the model makes up reasons.**

- `04`: Gili gets "a direct route along arterial roads". The model has no road data.
- ~~`03`: Shira gets "once transport options open up". The model never saw her
  mobility rule. It guessed from the times offered, and happened to guess right.~~

This is worse than a repeated sentence: a made-up reason reads as a fact.

> **Corrected while building, 16 Sep 2026 — the `03` example was wrong, and
> what it hid is bigger.** The model was not guessing about Shira: it was told.
> `scenarioAgentInput` in [evals/adapter.ts](../evals/adapter.ts) passes
> `occasion: scenario.description`, and that description is the trap explained
> for humans: _"until 20:00 she can only reach what she can walk to… the
> answer is a (venue, time) pair"_. It has done so for **every** eval run since
> A4 (7 Sep). `02` was told _"the best-rated venue… must never be the answer"_,
> `01` that the closest venue _"is not kosher"_. So the five passes A5 recorded
> were measured with the answer's reasoning in the prompt. The `04` example
> ("arterial roads") still stands. Fixed on this branch — see "Found while
> building" below.

### Options

| Option                                                                                                                     | For                                                                             | Against                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **A. Tell the model each person's hard constraints and tonight's mobility**, only as things it may mention, never to weigh | Fixes finding 2 at the cause. "Kosher, as you need" is a fact, not a comparison | Changes the prompt and the payload, so it needs live eval runs (quota). The model must still not second-guess the filter |
| **B. Reject an answer where everyone got the same text**                                                                   | Simple                                                                          | Wrong in `02`, where the same text is honest. It would fail correct runs, and there is no retry                          |
| **C. Measure it in the evals** (for example a "distinct explanations" count), without failing anything                     | Visible, costs nothing extra                                                    | Measures the problem, does not fix it                                                                                    |
| **D. Add a prompt rule: mention only facts you were given**                                                                | Aimed at finding 3                                                              | A prompt rule is a request, not a guarantee. Only a live run shows whether it works                                      |

**Recommendation: A + D, measured with C. Not B.** Keep it apart from part 1:
part 1 is a small deterministic check that needs no quota, while A and D change
what the model is told and can only be verified by live runs (`02`, `03`, `05`:
three requests).

> **Decided, 16 Sep 2026: A + D + C, inside A6, and built before part 1.**
> Recommendation approved as written, with one addition: **every justification
> is written in Hebrew, always.** That replaces the "English on a Hebrew
> screen" item that used to sit under "Noticed, and outside A6".

### Part 2 — what gets built

> **Trimmed before the live run, 16 Sep 2026.** The first build was reviewed
> for the shortest version that still fixes the defined problem. Cut:
> `starting_from` (nothing writes an amendment yet and no recorded case needed
> it), a per-pair `could_not_check` list (one prompt line about
> `"verified": false` does the same job), a schema description that repeated
> the prompt, and tests that only guarded the cut code. Fields are now always
> sent, so there is no conditional code for them.

**1. The payload tells the model what it may mention** (`buildPayload`):

- **Per person, `dietary_needs` and `allergies`**, from the profile's hard
  constraints, so a justification can _name_ them. The filter has already
  enforced them.
- **Per pair, `modes_unavailable_during_slot`**: who cannot use a car, transit
  or walking during that slot, from A2's `availableModes`, the same fact the
  filter trimmed on.

**2. The prompt** (`SYSTEM_PROMPT`):

- Every `reason` in Hebrew; names may stay as written.
- Gender-neutral: describe the place and the trip, not the person.
- Only facts given (D): no invented routes, roads, travel times, schedules or
  venue details.
- Never say a pair marked `"verified": false` meets a dietary need.
- A person's needs and lost travel modes are mentioned only to that person.
- The "right" and "forbidden" examples are in Hebrew.

**3. Hebrew is checked in code**, inside the existing justification loop in
`validateOptions`: a `reason` with more Latin letters than Hebrew ones, once
venue, neighbourhood and people's names are taken out, is rejected with
`AgentAnswerError`. With no retry, that is a failed run, accepted because an
English explanation on a Hebrew screen is a defect the person sees.

**4. The eval table measures it (C).** A `just` column, e.g. `2/4`: rank 1's
different explanations over its people. Never a verdict.

**5. Tests, no key, no quota:** the payload carries needs and lost modes; an
English reason, and an English sentence borrowing one Hebrew word, are
rejected; a Hebrew reason naming a Latin venue passes; the column counts.
Existing test answers are rewritten in Hebrew.

**6. The eval hint is removed** (see "Found while building"): the eval adapter
passes no occasion.

**7. Verify live: `03`, `05`, `06`, three requests.** Only the scenarios where
this change can move the result. `01` and `02` each leave exactly one legal
pair, so neither the hint nor the prompt can change their venue, and Hebrew is
already exercised by the other three. Pass means: the agreed venue still wins
without the hint, every reason is Hebrew, `05` names kosher to Adi and the
vegan option to Noam and to nobody else, `03` explains Shira's timing from the
fact it was given, and nothing is invented.

**Known consequence:** recordings in `evals/runs/` from before this change hold
English answers, so `--replay` on them now reports an error instead of a
verdict. They are gitignored and were measurements of the old prompt.

---

## Measured, 16 Sep 2026 — `03`, `05`, `06` without the hint

All three passed: same venues as agreed, 0 violations, $0.016, 10–12s each.
Recorded in `evals/runs/2026-09-16T13-25-29-907Z`.

- **Fixed:** every reason is Hebrew and gender-neutral. Nothing was invented.
  `05` is the case this was for: Adi is told the place is kosher, Noam that it
  has vegan dishes, Hila that it fits a modest budget, Eyal only where it is.
  Nobody is told anyone else's needs (`just` 4/4).
- **Not fixed, and now worse:** where people differ only in distance, the
  explanations went flat. `06` gave all three people "המפגש מתקיים בבת ים ביום
  ראשון בערב" (`just` 1/3), although Amit comes from Rishon LeZion and Keren
  and Doron from Rothschild, and two of them are over their tolerance. `03` is
  similar: the venue's street and the time, nothing about each person's trip.
  The 9 Sep run of `06` said "slightly beyond your usual 5 km". The likely
  cause is the new "say little" and "describe the place, not the person"
  wording, which the model read as "do not use the burden either". **Decided 16 Sep 2026: left as it is.** No prompt line is added for it; the
  `just` column keeps it visible.

---

## Found while building — fixed

**The eval set handed the model its own answer key.** See the correction under
finding 3. **Decided 16 Sep 2026: fixed on this branch.** `scenarioAgentInput`
no longer passes `scenario.description` as the occasion. A5's five passes were
measured with the hint, so the scenarios where it could matter are measured
again (item 7).

---

## Noticed, and outside A6

- **No retry on a rejected answer.** Once coverage is checked, a model that
  skips somebody fails the run. That is what the plan asks for. Whether B11
  retries once is B11's and B9's to decide.

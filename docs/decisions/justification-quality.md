# A6 — Per-participant justification quality

**Task:** A6 ([tasks/todo.md](../../tasks/todo.md), [#14](https://github.com/ron14y-sys/squad_lock/issues/14)) · **Built on:** A4 (the agent), A5 (the eval runner) · **Inherited by:** A7/A8 (the rejection loop regenerates justifications), B11 (builds the participant list), C6 (renders one)
**Plan and research:** [tasks/a6-plan.md](../../tasks/a6-plan.md) · **PR:** [#120](https://github.com/ron14y-sys/squad_lock/pull/120)

## What A6 is

The named risk in [tasks/plan.md](../../tasks/plan.md) is that one agent holding six profiles quietly drops one, most likely the person whose constraint is inconvenient. A4 already rejected a justification addressed to a stranger and left the mirror case here. A6 closes it, and — from what the recorded runs showed while closing it — makes the justifications worth reading.

Everything runs in `validateOptions` in [lib/matching/agent.ts](../../lib/matching/agent.ts), which every run passes through, model or hand-written.

## The decisions

### 1. A missing person is a failed run, not a smaller proposal

Every option must justify itself to every participant, **on all three ranks** — ranks 2 and 3 are persisted, shown as "we also considered", and carried into the next cycle by A8b. The error names who is missing and on which rank. It is an `AgentAnswerError`: the answer was the wrong shape.

**Who counts as a participant is not decided here.** A6 checks the answer against `input.participants`. Building that list — including whether somebody who said "I can't make it" is on it — belongs to B11, which assembles the run.

### 2. Justifications are in Hebrew, and code enforces it

The app is `lang="he" dir="rtl"`, and a justification is prose written by the model rather than a stored fact the formatting layer can translate later (unlike `unverifiedNote`, [hard-constraints.md](hard-constraints.md)). So the language has to be right at the source.

`isHebrew` counts letters: **more Hebrew than Latin, once venue, neighbourhood and people's names are removed.** Not "contains any Hebrew" — an English sentence naming a Hebrew venue would pass that. Not a plain letter count either — Places returns plenty of Latin names, and "קרוב לבית" beside one is still a Hebrew sentence.

**Hebrew is gendered and we hold nobody's gender.** The prompt asks for phrasing that does not depend on it: describe the place and the trip, not the person.

### 3. The model is told what it may name, not what to weigh

Recorded runs showed two failures with one cause — a payload too thin to write from:

- **Identical sentences** for people the model could not tell apart. In `05`, Adi needs kosher and Noam a vegan option, and the model was told neither.
- **Invented reasons.** `04` told Gili about "a direct route along arterial roads". There is no road data anywhere in this system.

So the payload now carries each person's `dietary_needs` and `allergies`, and per pair `modes_unavailable_during_slot` from A2's own `availableModes`. **These are facts to name, never inputs to weigh** — §4.1b still holds, and the filter has already enforced all of them. Three prompt rules guard the new data:

- Use only facts given. No invented route, road, travel time, schedule or venue detail.
- Never say a pair marked `"verified": false` meets a dietary need — that is exactly what could not be checked.
- A person's needs and lost travel modes are mentioned **only in that person's own justification**. Handing the model private facts is what makes disclosing them possible.

### 4. A comparison is forbidden by the prompt, not by a word list

§5.6's "no comparative cost line" stays the prompt's job. A banned-word list would reject good answers, and with no retry a rejected answer is a failed run. What _is_ enforced in code is the data path: a type test fails if a trade-off field is ever added to `ProposalDTO`, the shape the meeting screen receives.

### 5. The eval set was handing the model its answer key

Found while building this. `scenarioAgentInput` passed each scenario's `description` — the trap explained for us — as the meeting occasion, on **every** run since A4. `03` was told "until 20:00 she can only reach what she can walk to"; `01` that the closest venue "is not kosher". Removed.

The scenarios where a hint could change the venue were re-measured without it, 16 Sep 2026:

| Scenario                               | Verdict  | Time  | Distinct explanations |
| -------------------------------------- | -------- | ----- | --------------------- |
| `03-mobility-window-trap`              | **PASS** | 11.7s | 2/3                   |
| `05-no-perfect-solution-diet-conflict` | **PASS** | 10.2s | 4/4                   |
| `06-no-perfect-solution-dispersed`     | **PASS** | 12.1s | 1/3                   |

Zero hard-constraint violations, $0.016. `01` and `02` leave exactly one legal pair each, so no prompt can change their venue; they were not re-run. `npm run eval` now prints the distinct-explanation count as a `just` column — **information, never a verdict**: in `02` three identical people honestly get one sentence.

`05` is the case this was all for: Adi is told the place is kosher, Noam that it has vegan dishes, Hila that it fits a modest budget, Eyal only where it is. Nobody is told anyone else's needs.

## What A6 does not do

- **No retry.** A skipped participant or a non-Hebrew reason fails the run, and nothing asks the model again. Whether B11 retries once is B11's and B9's call.
- **It does not make a flat justification fail.** Where people differ only in distance, the explanations came out generic — `06` gave all three the same sentence although one travels from another city. Decided on 16 Sep 2026 to leave it and keep it visible in the `just` column rather than add another prompt rule.
- **Old recordings in `evals/runs/` can no longer be replayed:** their English justifications are now rejected. The directory is gitignored, and they measured the old prompt.

## Where it lives

`validateOptions` and `buildPayload` in [lib/matching/agent.ts](../../lib/matching/agent.ts) · `distinctJustifications` in [evals/sweep.ts](../../evals/sweep.ts) · no occasion in [evals/adapter.ts](../../evals/adapter.ts) · tests in [lib/matching/agent.test.ts](../../lib/matching/agent.test.ts) and [\_\_tests\_\_/eval-sweep.test.ts](../../__tests__/eval-sweep.test.ts).

**Issue #14 names `lib/matching/validate.ts`, which does not exist.** A4 put the checks in `validateOptions`, and a second validation file would have split one answer's rules across two.

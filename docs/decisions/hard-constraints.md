# Hard constraints — the filter, the post-check, and what happens when we do not know

**Task:** A2 ([tasks/todo.md](../../tasks/todo.md)) · **Blocks:** A4 (Group Matching Agent), B7c (candidate funnel)
**Status:** complete. `lib/matching/constraints.ts`, 20 tests, no LLM and no network.

---

## The question

[Spec §4.1b](../spec.md) is unusually direct: hard constraints are "enforced in code, never delegated to the agent," because "a model that 'mostly' respects an allergy is not acceptable."

That settles _who_ enforces them. It leaves two things open, and this file closes both:

1. **What counts as a hard constraint**, given that the same venue is fine at 15:00 and impossible at 20:00.
2. **What to do when we cannot check one** — which is not a rare edge case here, it is the normal state of a Google Places result.

## Two passes, one set of rules

|                               | Runs             | Answers                                                             |
| ----------------------------- | ---------------- | ------------------------------------------------------------------- |
| **`filterPairs`**             | Before the agent | Which `(venue, slot)` pairs is the agent allowed to choose between? |
| **`assertChosenPairAllowed`** | After the agent  | Is the pair it actually chose still legal?                          |

Both call the same `checkPair`, so they cannot drift apart. The filter is the prevention; the post-check is the proof. Keeping both is the point: one agent holding six profiles at once has more opportunities to drop a person than a filter does, and a filter cannot catch a venue the agent invented.

**The post-check throws.** `checkChosenPair` returns the findings for a caller that wants to log them, but the function A4 calls is `assertChosenPairAllowed`, and it raises `HardConstraintError`. A guard whose result can be ignored is a comment — the lesson of #71, and of A1 shipping `assertReportableCost` with no caller. The answer to a violation is a failed run, never a proposal sent to somebody who cannot eat there.

The post-check also catches the two things only an _answer_ can get wrong, which the filter by construction cannot: **`not_a_candidate`** (a venue that was never in the pool) and **`slot_not_offered`** (a time nobody proposed).

## Everything is a `(venue, slot)` pair

A venue alone is not a thing this code can rule on. The same café is legal at 15:00 and illegal at 20:00 — it closes, or somebody loses the car at 18:00. So the unit of the filter is the pair, and its output is not "these venues survived" but "these venues survived **at these hours**." [Spec §5.4](../spec.md) states this; F3 built the types for it (`viableSlots`, `Burden.slot`) before there was any code to use them.

The eight things that can go wrong:

| Kind                                   | Source                                                | Note                               |
| -------------------------------------- | ----------------------------------------------------- | ---------------------------------- |
| `closed`                               | The venue's opening hours                             | Only when we know them — see below |
| `unavailable`                          | `hardConstraints.unavailable`                         | Fixed hours a person stated        |
| `busy`                                 | Google Calendar free/busy                             | Instants, not wall clock           |
| `immobile`                             | Mobility rules and windows                            | The binary half only — see below   |
| `dietary` · `allergy`                  | `hardConstraints`, against what is known of the venue |                                    |
| `not_a_candidate` · `slot_not_offered` | The agent's answer                                    | Post-check only                    |

## Where the line with A3 is

A2 answers **"is this pair possible at all"** — a yes or a no. A3 answers **"how bad is it for each person"** — the burden number and the gate on `T`. [B7c](../../tasks/todo.md) keeps them as separate stages of the funnel for exactly this reason.

So **mobility appears here only in its binary form**: a person with _no_ mode available at that hour cannot get anywhere, whatever the distance, and the pair dies. "Can only walk, so 9 km is too far" is a _tolerance_ — a smaller denominator in the burden formula — and it belongs to A3 and A12. Putting it here would mean A2 computing distances, which is the one thing the funnel's shape says it should not do.

Precedence follows [§5.7](../spec.md): tonight's amendment outranks the profile's recurring rules, which outrank the default of "everything works". So the rules are applied first and the amendment's windows last, and "no car on Fridays" plus "I borrowed the car tonight" resolves the way the person meant it.

## Unknown is not a violation

**This is the decision that shapes the rest.**

`regularOpeningHours` is an Enterprise-tier Places field against the smallest free allowance in the pricing model — 1,000 requests a month ([spec §6.3](../spec.md)) — which is why [§13.7](../spec.md) has not yet decided whether we fetch it for every candidate or only for a shortlist. Dietary suitability is worse: nothing in the field mask answers "is this place kosher" at all.

So for many candidates we will simply not know. Three ways to handle that:

|                         | Behaviour                            | Consequence                                                                                                                                          |
| ----------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drop the unknown        | Only verified venues survive         | The pool silently shrinks to whatever we happened to pay for. A group in a neighbourhood with poor Places coverage gets `stuck` for a billing reason |
| Pass it silently        | Everything survives                  | We eventually propose a closed restaurant and say nothing. The user finds out at the door                                                            |
| **Pass it, and say so** | Everything survives, carrying a flag | **Chosen**                                                                                                                                           |

Every allowed pair carries an `unverified: UnverifiedFact[]`. Empty means fully checked. Non-empty names what could not be checked — `opening_hours`, or a dietary tag — deduplicated, so six participants sharing "kosher" produce one entry and not six.

An empty `openingHours` array is treated the same as a missing one: a venue Places returned no hours for, not a venue that never opens. Permanently shut is `businessStatus`, a different field, dropped at [B7](../../tasks/todo.md).

### What A4 does with it

The flag is not a log line. It is an input to the agent's choice and to what the user is told:

1. **A4 strongly prefers pairs with nothing unverified.** A venue whose hours we confirmed beats one we could not check, all else equal.
2. **When A4 falls back to an unverified pair, the proposal says so** — an asterisk against the venue, and a note telling the person to ring ahead and confirm the opening time.

This is the honest version of the §13.7 trade-off. We neither pretend to knowledge we did not buy, nor throw away a good candidate because of a field tier. It also keeps the decision cheap to reverse: if §13.7 later settles on fetching hours for every candidate, `unverified` simply comes back empty and the disclaimer stops appearing on its own.

**A justification must never turn this into a comparative cost line** ([§5.6](../spec.md)). "We could not confirm they are open, so please call ahead" is a fact about the venue. "You got this one because the better place could not be verified" is what §5.6 forbids.

## The dietary shape, and who fills it

`Candidate` deliberately does not carry dietary facts, because it is not settled that we can fetch them. `VenueDietaryFacts` lives with the filter instead, and has **three** states per tag rather than two:

```ts
{ satisfies: ["kosher"], violates: ["shellfish"] }   // and everything else: not known
```

Not known is neither, and never drops a candidate. B7 fills this in from whatever source ends up answering the question. Until then every candidate is unverified on every tag, the filter is correct, and A4 tells the user the truth.

Tags are free text on both sides — [`lib/types/profile.ts`](../../lib/types/profile.ts) chose that on purpose, "because the vocabulary is still open and an unknown value must be _carried_, not dropped," and said the normaliser belongs with the filter. It does: `normaliseTag`, which lowercases and trims and maps nothing away.

## The time edge

[`lib/types/primitives.ts`](../../lib/types/primitives.ts) names three places where `APP_TIME_ZONE` turns local wall clock into an instant. This file is the first of them, and it handles two of the three: opening hours, and mobility windows.

Slots are instants — a machine wrote them. Opening hours, unavailable hours and mobility windows are wall clock — a human said them, and meant no zone. Both are projected onto one axis of minutes since Sunday 00:00 local, and compared there.

Two things this buys, both covered by tests:

- **DST is correct.** 18:30 in Jerusalem is 15:30Z in July and 16:30Z in January. Arithmetic on the UTC value gets one of them wrong; `Intl.DateTimeFormat` with the zone gets both right, because it owns the offset table.
- **A window inside a slot is caught.** Sampling only the start and end of a slot misses "no car 18:00–21:00" against a slot running 12:00 to 23:00 — neither endpoint is in the window, and the middle is. The comparison is interval against interval, not point sampling.

A window whose `to` is at or before its `from` crosses midnight, and a slot may cross Saturday night into Sunday. Both run past the end of the weekly axis and are compared with a wrap.

**Coverage is containment in a single window, not in their union.** A slot spanning the gap between a lunch sitting and a dinner sitting is not a slot the venue can host, and is correctly rejected.

## Seeing it run

Unit tests prove the behaviour; they do not let anybody watch it. `scripts/demo-matching.ts` does:

```
npm run demo                 # filter, one real Gemini call, both post-checks
npm run demo -- --offline    # everything except the call. No key, no quota, no cost
npm run demo -- --fallback   # drop the verified venues, so the "ring ahead" path runs
npm run demo -- --verbose    # list every dropped pair, not just the reasons
```

Four people carrying one kind of hard constraint each, six venues, four slots — 24 pairs, of which **7 survive**. It prints the grid, then every reason a pair died, then hands the survivors to A1 and prints the streamed answer with its tokens and its cost, then runs the post-check twice: once on what the agent actually said, and once on four fabrications that must not pass.

Two real runs, on the free tier:

|              | Model                      | Wall clock | Cost      |
| ------------ | -------------------------- | ---------- | --------- |
| Default pool | `gemini-3.6-flash` / `low` | 12.2s      | $0.006933 |
| `--fallback` | `gemini-3.6-flash` / `low` | —          | $0.004088 |

The fallback run is the one worth watching: with the verified venues removed, the agent takes the unverified café, and the proposal comes back with the asterisk and "give them a ring before you set off."

Stage 6 always runs against the **full** pool, whatever `--fallback` did to the pool above it. Against a trimmed pool all four fabrications collapse into `not_a_candidate`, which demonstrates one rule four times instead of four rules once.

The demo is not a test and nothing in the app imports it. It needs `tsx`, which is a dev dependency for exactly this — a TypeScript file that has to run outside Next and outside Vitest, with `@/` still resolving.

## What A2 deliberately does not do

- **No distance and no burden.** A3, and the gate at B7c.
- **No rating.** It is not a constraint, and [§13.6](../spec.md) has not decided whether we fetch it. The filter drops a 4.9-star venue that breaks a constraint without looking at the number — there is a test for exactly that.
- **No dedupe and no shortlist assembly.** B7c owns the funnel; A2 is one stage inside it.
- **No opinion on `stuck`.** When nothing survives, `filterPairs` returns an empty `viable` and a full `dropped` with every reason. Turning that into a status is A8's.

`dropped` is kept rather than discarded because a run is persisted in full ([§4.1d](../spec.md)), and because "nothing survived" has to be explainable to a person rather than shown as an empty list.

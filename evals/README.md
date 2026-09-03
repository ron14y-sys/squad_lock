# Eval set — SquadLock

Ground-truth scenarios for the matching engine, written **before the engine exists** (spec §9, [tasks/todo.md F5](../tasks/todo.md)). Each scenario is a made-up group, their calendars and constraints, a set of candidate venues, and the answer the three of us agree is correct — with the reasoning, so a future disagreement can be traced back to a rule rather than a feeling.

**This is not a benchmark and doesn't claim to be one.** It's a hand-verified trap suite: a small set of cases specifically designed to catch the failure modes the architecture is supposed to prevent. See [docs/design-review-prep.md §4](../docs/design-review-prep.md) for that framing.

## How a scenario gets its "correct" answer

No engine exists yet to run these against. The expected answer in every file is computed **by hand**, using the same rules the deterministic layer will eventually implement:

1. Drop any venue that violates a hard constraint (kosher, allergy, etc.) — spec §4.1b.
2. **Trim** each `(venue, time)` pair to the hours the venue is actually open, and drop it only if nothing survives — or if a participant has no viable way to get there in what does survive — spec §5.4, §5.7. See "The meeting shortens to fit the venue" below.
3. Among what's left, apply leximin: the candidate that minimizes the worst participant's burden wins; ties are broken by the second-worst, then the third — spec §5.4.

Steps 1–3 are mechanical — two people applying them by hand to the same scenario should reach the same answer. Where they don't, the scenario is underspecified and needs fixing, not the disagreement.

**`05-no-perfect-solution-diet-conflict.json` is the exception.** There, steps 1–2 still apply mechanically, but step 3 doesn't produce a single forced answer — multiple venues survive and none dominates the others on every axis. For that one, `expected` records the team's actual agreed choice and reasoning, not a computed one. It was resolved after starting from a proposed recommendation rather than a blank page — worth doing again the next time a scenario lands here without a mechanically forced answer.

**`06-no-perfect-solution-dispersed-group.json` is not that kind of exception, and treating it as one is what broke it** ([#86](https://github.com/ron14y-sys/squad_lock/issues/86)). Its two candidates have distinct leximin vectors, so step 3 does force an answer — the "no perfect solution" in its name means every venue leaves _someone_ over tolerance, not that the choice between them is a matter of taste.

### The meeting shortens to fit the venue

**A venue does not have to be open for the whole window the group is free.** The slot is the **intersection** of the two, and the meeting shortens to fit. A venue that closes at 22:30 when the group is free until 23:00 is not eliminated — it is a venue where the evening ends at 22:30.

This is [B6](../tasks/todo.md)'s job, and has been since F5: _"free slots common to all confirmed participants, **intersected with venue opening hours and mobility windows** to produce viable `(venue, time)` pairs (spec §5.4)"_. Only an **empty** intersection drops the pair — which is exactly the `02-closed-on-the-night-trap` scenario, where the best-rated venue shuts at 20:00 and the group is not free until 21:00.

Two consequences for whoever writes a scenario:

- **`expected.time` is required whenever the venue's hours trim the group's window**, not only in mobility-window scenarios — because then the answer genuinely is a `(venue, time)` pair rather than a venue. It carries a start **and** an end.
- **Do not confuse this with `windowsCoverSlot` in [`lib/matching/constraints.ts`](../lib/matching/constraints.ts)**, which demands the _whole_ slot sit inside a _single_ opening window. That rule is right, and it runs **after** the trimming — its job is to stop a slot spanning the gap between lunch and dinner service, not to reject a venue that closes early.

**The shortest meeting worth proposing is three hours.** An intersection below that is not a meeting, so a scenario has to leave the expected venue at least three hours after trimming. Two scenarios did not when the number was agreed, and both had their availability widened rather than their venue changed: 02 from 21:00 to 20:00 (Anna Loulou still shuts at 20:00, so an intersection of zero length keeps the trap intact) and 05 from 20:30 to 19:30 (HaKosem still shuts at 22:30, so the trimmed evening is now exactly three hours).

### Distances are computed, never estimated

Every distance a scenario states is a **straight line between the coordinates in that same file**, computed with `straightLineKm` from [`lib/matching/distance.ts`](../lib/matching/distance.ts) — the same function the engine uses.

Never write a road distance. That is exactly how #86 happened: 06 said "~13 km" and "~9 km" where the straight lines are 10.45 km and 5.77 km, and the two errors were unequal enough to invert the answer. 04 said a venue was a participant's nearest when it was the farther of the two, which left its trap with nothing to catch. Both estimates read as reasonable and neither was.

The burden formula is defined on a straight line with a detour factor. **The system does not compute driving or travel time, and no scenario, document or UI string may say that it does** (spec §5.4). A scenario written in road distances quietly asks the engine to do something it must not do.

[`__tests__/eval-scenarios.test.ts`](../__tests__/eval-scenarios.test.ts) recomputes 04 and 06 from their own coordinates on every `npm test`, so prose that drifts from the numbers fails immediately rather than months later in a pass-rate report.

## Scenario format

```json
{
  "id": "kebab-case-id",
  "trap": "hard-constraint | closed-on-the-night | mobility-window | semantic-geography | no-perfect-solution | rejection-loop",
  "description": "One sentence: what this scenario is designed to catch.",
  "unresolved": "optional — present only while a scenario is known not to test what it claims",
  "participants": [
    /* name, neighborhood, coordinates, hardConstraints, softPreferences, toleranceKm */
  ],
  "availability": [/* day, date (YYYY-MM-DD), start, end */],
  "candidateVenues": [
    /* placeId, name, neighborhood, coordinates, dietary, openingHours, rating */
  ],
  "expected": {
    "venue": "...",
    "time": { "start": "HH:MM", "end": "HH:MM" },
    "reasoning": "..."
  }
}
```

`expected.time` is required for mobility-window scenarios and wherever the venue's opening hours trim the group's window; it is omitted only when the whole window survives.

`rejection-loop` scenarios add `initialProposal`, `rejection` (who, free text), and `expectedConstraint` (the structured constraint the Constraint Updater should extract) alongside `expected` (the follow-up proposal).

### What the fixture says, and what the engine reads

A scenario is **wrong** when it says something the engine cannot express, and merely **different** when it says the same thing in a friendlier way. The first kind gets fixed in the file. The second stays, and the mapping lives here.

| Fixture                                       | Engine                                                    | Why it is only a spelling                                                                    |
| --------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `hardConstraints: ["kosher"]`                 | `{ dietary: ["kosher"], allergies: [], unavailable: [] }` | Lossless. Which bucket a tag belongs in is the adapter's business, not the scenario author's |
| `openingHours: { "Monday": ["11:00-22:30"] }` | `LocalWindow[]`                                           | Lossless, and this is the shape Places actually returns                                      |
| `availability: { day, date, start, end }`     | one or more `TimeSlot`s                                   | Needs the date, which is why the date is there                                               |
| `neighborhood`                                | `neighbourhood`                                           | Two spellings of one word                                                                    |

And the things that **were** wrong, fixed in [#86](https://github.com/ron14y-sys/squad_lock/issues/86):

| Was                                   | Now                                | What could not be said                                                                                                                                                                                                                                                                                                          |
| ------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kosher: false`, `veganOptions: true` | `dietary: { satisfies, violates }` | A2 has **three** states, and the third — _not known_ — never drops a candidate, it marks the pair unverified for A4 to warn about. A boolean cannot say which one it means. Tags match through `normaliseTag`, which lowercases and trims and maps nothing, so `"vegan-option-required"` must be spelled the same on both sides |
| no venue coordinates                  | `coordinates` on every venue       | `Candidate.location` is required, and A3 divides by it. Where they were added, the expected answer was also made the nearest, so no scenario quietly asks the agent to overrule the fairness order                                                                                                                              |
| no venue id                           | `placeId` on every venue           | The dedupe key, the cache key, A3's leximin tiebreak, and the id inside every `ConstraintViolation`. Deliberately readable rather than a real Places id, so a failing assertion names a venue                                                                                                                                   |
| `softPreferences: { budget: "low" }`  | `budget: "modest"`                 | `SoftPreferences.budget` is `"modest" \| "splurge"`. `"low"` is not a value it has                                                                                                                                                                                                                                              |
| `mobilityWindows: { mode: "no-car" }` | removed — see 03                   | The real type is `{ mode: "car" \| "transit" \| "walk", available: boolean, window }`, so "no car" is `{ mode: "car", available: false }`                                                                                                                                                                                       |

**Still not expressible, and tracked in #86:** `SoftPreferences` has no "no opinion" value — all four fields are required, produced by the preference game. So 05's premise, that Hila is the only person who stated a preference, cannot be written down. Choosing values for the other three participants would change the answer, so the fields were left as they are and the question goes to the team.

## Required coverage (spec §9)

| #   | File                                          | Trap                | Why it's here                                                                                                                                                                                                                                                 |
| --- | --------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `01-hard-constraint-trap.json`                | hard-constraint     | The best-rated venue violates a hard constraint. It must never be the answer.                                                                                                                                                                                 |
| 2   | `02-closed-on-the-night-trap.json`            | closed-on-the-night | The best-rated venue is shut at every time the group is free.                                                                                                                                                                                                 |
| 3   | `03-mobility-window-trap.json`                | mobility-window     | ⚠️ **Unresolved.** The car element was removed in [#86](https://github.com/ron14y-sys/squad_lock/issues/86) — the engine cannot express it. The file is mechanically correct but traps nothing, so §9's mobility-window requirement is currently **not** met. |
| 4   | `04-semantic-geography-trap.json`             | semantic-geography  | Straight-line distance alone picks the wrong venue across a highway barrier — measures the Context Resolver's detour factor.                                                                                                                                  |
| 5   | `05-no-perfect-solution-diet-conflict.json`   | no-perfect-solution | Conflicting hard/soft requirements; the answer is agreed, not computed.                                                                                                                                                                                       |
| 6   | `06-no-perfect-solution-dispersed-group.json` | no-perfect-solution | Every candidate leaves someone over their tolerance, and leximin picks the lower-rated venue anyway.                                                                                                                                                          |
| 7   | `07-rejection-loop-noise.json`                | rejection-loop      | A rejection about atmosphere must produce a visibly quieter follow-up.                                                                                                                                                                                        |
| 8   | `08-rejection-loop-budget.json`               | rejection-loop      | A rejection about cost must produce a visibly cheaper follow-up.                                                                                                                                                                                              |

8 of 8–12 required, all agreed by the team — but see the warning on row 3: seven of them currently test what they claim to.

## What happens to these later

Once the matching engine exists (Track A), task **A5 — Eval runner** reads every file in this folder, runs the real engine against each one, and reports pass rate, cost, duration, and hard-constraint violations (must be zero). Nothing in this folder changes when that happens — these are answers, not implementation, which is what makes them useful as a check on the engine rather than a description of it.

An answer changes only the way #86's did: because it contradicted the rules in "How a scenario gets its correct answer", agreed by all three of us, and never because the engine disagreed with it.

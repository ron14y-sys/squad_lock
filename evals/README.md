# Eval set — SquadLock

Ground-truth scenarios for the matching engine, written **before the engine exists** (spec §9, [tasks/todo.md F5](../tasks/todo.md)). Each scenario is a made-up group, their calendars and constraints, a set of candidate venues, and the answer the three of us agree is correct — with the reasoning, so a future disagreement can be traced back to a rule rather than a feeling.

**This is not a benchmark and doesn't claim to be one.** It's a hand-verified trap suite: a small set of cases specifically designed to catch the failure modes the architecture is supposed to prevent. See [docs/design-review-prep.md §4](../docs/design-review-prep.md) for that framing.

## How a scenario gets its "correct" answer

No engine exists yet to run these against. The expected answer in every file is computed **by hand**, using the same rules the deterministic layer will eventually implement:

1. Drop any venue that violates a hard constraint (kosher, allergy, etc.) — spec §4.1b.
2. Drop any `(venue, time)` pair where the venue is shut, or a participant has no viable way to get there in that slot — spec §5.4, §5.7.
3. Among what's left, apply leximin: the candidate that minimizes the worst participant's burden wins; ties are broken by the second-worst, then the third — spec §5.4.

Steps 1–3 are mechanical — two people applying them by hand to the same scenario should reach the same answer. Where they don't, the scenario is underspecified and needs fixing, not the disagreement.

**The two `no-perfect-solution` scenarios are the exception.** There, steps 1–2 still apply mechanically, but step 3 doesn't produce a single forced answer — multiple venues survive and none dominates the others on every axis. `"consensusRequired": true` marks this in the file. The three of us have to actually agree on one before it's usable as ground truth; it isn't something to compute alone.

## Scenario format

```json
{
  "id": "kebab-case-id",
  "trap": "hard-constraint | closed-on-the-night | mobility-window | semantic-geography | no-perfect-solution | rejection-loop",
  "description": "One sentence: what this scenario is designed to catch.",
  "participants": [
    /* name, neighbourhood, coordinates, hardConstraints, softPreferences, toleranceKm, optional mobilityWindows */
  ],
  "availability": [/* shared free slots */],
  "candidateVenues": [
    /* name, neighbourhood, coordinates, kosher, openingHours, rating */
  ],
  "expected": {
    "venue": "...",
    "time": "optional — required for mobility-window scenarios",
    "reasoning": "..."
  }
}
```

`rejection-loop` scenarios add `initialProposal`, `rejection` (who, free text), and `expectedConstraint` (the structured constraint the Constraint Updater should extract) alongside `expected` (the follow-up proposal).

## Required coverage (spec §9)

| #   | File                                          | Trap                | Why it's here                                                                                                                |
| --- | --------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | `01-hard-constraint-trap.json`                | hard-constraint     | The best-rated venue violates a hard constraint. It must never be the answer.                                                |
| 2   | `02-closed-on-the-night-trap.json`            | closed-on-the-night | The best-rated venue is shut at every time the group is free.                                                                |
| 3   | `03-mobility-window-trap.json`                | mobility-window     | A participant has no car for part of the evening — the answer is a `(venue, time)` pair, not a venue.                        |
| 4   | `04-semantic-geography-trap.json`             | semantic-geography  | Straight-line distance alone picks the wrong venue across a highway barrier — measures the Context Resolver's detour factor. |
| 5   | `05-no-perfect-solution-diet-conflict.json`   | no-perfect-solution | Conflicting hard/soft requirements; the answer is agreed, not computed.                                                      |
| 6   | `06-no-perfect-solution-dispersed-group.json` | no-perfect-solution | Every candidate leaves someone over their tolerance.                                                                         |
| 7   | `07-rejection-loop-noise.json`                | rejection-loop      | A rejection about atmosphere must produce a visibly quieter follow-up.                                                       |
| 8   | `08-rejection-loop-budget.json`               | rejection-loop      | A rejection about cost must produce a visibly cheaper follow-up.                                                             |

8 of 8–12 required. Scenarios 5 and 6 still need a three-way sign-off (see `consensusRequired`) before they're final — everything else is ready to sign off as-is or challenge.

## What happens to these later

Once the matching engine exists (Track A), task **A5 — Eval runner** reads every file in this folder, runs the real engine against each one, and reports pass rate, cost, duration, and hard-constraint violations (must be zero). Nothing in this folder changes when that happens — these are answers, not implementation, which is what makes them useful as a check on the engine rather than a description of it.

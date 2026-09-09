# The meeting shortens to fit the venue

**Task:** carved out of [B6](../../tasks/todo.md) · **Unblocks:** eval scenarios `03`, `05`, `07`
**Found by:** the first A5 eval sweep ([#104](https://github.com/ron14y-sys/squad_lock/pull/104)), which is where the numbers quoted below come from
**Status:** complete. `trimPairToViableSlots` in [`lib/matching/constraints.ts`](../../lib/matching/constraints.ts), 12 tests, no LLM, no network, no database.

---

## Why this exists as its own piece of work

The rule had been **defined in four places that agree with each other** and
**implemented in none**:

| Where                                                     | What it says                                                               |
| --------------------------------------------------------- | -------------------------------------------------------------------------- |
| [`evals/README.md`](../../evals/README.md)                | "A venue does not have to be open for the whole window the group is free." |
| B6's acceptance, [`tasks/todo.md`](../../tasks/todo.md)   | "intersected with venue opening hours and mobility windows"                |
| [spec §5.4](../spec.md), the funnel                       | "drop anything open at no viable time"                                     |
| [#86](https://github.com/ron14y-sys/squad_lock/issues/86) | the three-hour minimum, in both places it can be measured                  |

What existed in code was the **opposite**: `windowsCoverSlot` demands the whole
slot sit inside a single opening window, and drops the pair when it does not.
A venue closing at 22:30 against a group free until 23:00 was deleted rather
than shortened.

The cost was not theoretical. It silently broke three of the eight eval
scenarios, and two of them in the worst possible way:

| Scenario | What happened before                                                                    |
| -------- | --------------------------------------------------------------------------------------- |
| `03`     | the agreed answer was reachable, but at the wrong hour                                  |
| `05`     | the agreed answer was **filtered out**, and a different venue survived and was proposed |
| `07`     | the agreed answer was **filtered out**, and a different venue survived and was proposed |

A missing stage reported as a legal, confident, wrong answer is the expensive
kind of wrong. `needsTrim` in `evals/adapter.ts` was written to detect exactly
this, and A5's first sweep is what turned it from a comment into a number.

## The decision that made it a separate task

**The trimming has no Google dependency, and it was sitting behind one.**

It lived inside a task called _"B6 — Google Calendar read and availability"_, so
a piece of pure interval arithmetic was blocked on an OAuth integration it does
not use. What it actually needs — free slots, opening hours, mobility caps —
already existed as types, already existed in every eval fixture, and
[spec §12](../spec.md) already lists "availability and opening-hour
intersection" among the deterministic things unit-tested **with no LLM
required**.

So it was built now, from the fixtures, and **B6 no longer has to write it.**
B6's remaining job is Google Calendar: read each participant's free/busy, derive
the group's common free windows, and hand each one to this function per
candidate.

## What it does

```ts
trimPairToViableSlots({ slot, candidate, participants, distanceKm }): TimeSlot[];
```

Empty means the pair is dropped. **More than one is a real answer, not a bug** —
a venue open for lunch and again for dinner across a group free all afternoon
offers two distinct evenings, and choosing between them is the agent's job.

Two narrowings, in order:

1. **Opening hours**, intersected with **each window separately, never their
   union.** That is what guarantees a returned slot never spans the gap between
   lunch and dinner service — and it is why `windowsCoverSlot` still passes
   afterwards rather than being replaced.
2. **Reach.** How someone travels caps how far they can get: on foot about a
   kilometre, transit and a car uncapped ([#89](https://github.com/ron14y-sys/squad_lock/issues/89)).
   A participant who cannot reach the venue for part of the evening removes
   **those hours**, not the venue.

## Four decisions inside it

### 1. Reach is not tolerance

Only the physical cap of how somebody is travelling narrows an hour. Being
further away than a person is _comfortable_ with is a **burden**, and leximin is
what weighs it — scenario `06`'s agreed answer puts two people at 1.15 times
their stated tolerance and is still the right answer.

Applying `toleranceKm` here would have turned a soft cost into a hard constraint
and quietly deleted the fairness question the product exists to answer. There is
a test asserting it does not.

### 2. `windowsCoverSlot` was kept, not replaced

Trimming decides how long the evening is; `windowsCoverSlot` refuses a slot that
spans a service gap. They answer different questions, they run in that order,
and a test asserts every slot this function returns survives the later check.

### 3. Unknown hours narrow nothing

Absent or empty `openingHours` means **not known** — not "open around the
clock" and not "drop it". That is the rule `venueViolations` already follows,
and the pair is marked `unverified` so A4 can attach the ring-ahead note.

### 4. It runs before `windowsCoverSlot`, and it is checked, not trusted

`reachCapKm` returns `null` for a participant with **no mode at all**, meaning
_uncapped_ — reading that as "can go anywhere" is exactly backwards, so the
empty-mode case is tested separately as `immobile` before the cap is consulted.
This is the one sharp edge in the existing API, and it is now handled in the two
places that consult it.

## The three-hour minimum, in both places

`MINIMUM_MEETING_MINUTES = 180`, one number, two gates (#86, question 6):

- **The group's own free window**, before any venue is considered —
  `meetsMinimumLength`. Too short there is `stuck` with a reason, not an empty
  shortlist. **B6 owns calling this.**
- **The slot left after narrowing** — inside `trimPairToViableSlots`. Too short
  there drops that one pair and nothing else.

## Wired

`evals/adapter.ts` calls it, through `filterTrimmedPairs` — trim each candidate
to the hours it can host, then filter. `03` and `05` moved from blocked to
scored the moment it did, with no edit to `classify`, because that rule reads
`trap` rather than a list.

`__tests__/slot-trimming.test.ts` closes the loop without a model: for every
scenario `needsTrim` flags, the pipeline now offers the expected venue at the
expected hours — and `02` is still dropped, which is what stops "the meeting
shortens" from quietly becoming "we never drop anything".

The pipeline wiring — calendar free/busy in, `(venue, slot)` pairs out —
remains B6's. It is the same call.

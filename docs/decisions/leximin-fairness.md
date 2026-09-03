# Leximin fairness — the burden number, the ordering, and what it deliberately refuses to do

**Task:** A3 ([tasks/todo.md](../../tasks/todo.md)) · **Blocks:** A4 (Group Matching Agent), B7c (candidate funnel) · **Feeds:** A12, A13 (Context Resolver)
**Status:** complete. `lib/matching/distance.ts`, 52 tests, no LLM and no network.

---

## The question

A2 answered _"is this `(venue, slot)` pair possible at all"_ — a yes or a no. A3 answers the next one: **"how bad is it for each person, and which candidate is fairest?"**

[Spec §5.4](../spec.md) fixes the shape of both halves of that answer, so this file had little to invent and a lot to get right:

```
burden = straight_line_distance × detour_factor / tolerance_km
```

Dimensionless, so six people with six different tolerances compare on one axis without an exchange rate between them. `1.0` is exactly what somebody said they could manage; `1.4` is half again as far.

Then **leximin**: sort each candidate's burdens worst-first and compare lexicographically. Worst against worst; on a tie, the second-worst; then the third.

## Why leximin and not minimax

Plain minimax — comparing only `max(burden)` — is what §5.4 originally described, and it is degenerate. Two candidates with the same worst-off participant are _exactly equivalent_ to it, even when one is far better for everyone else. The tie then falls through to star rating, and the fairness silently disappears at precisely the moment it was supposed to act.

```
[1.8, 1.2, 0.9]  beats  [1.8, 1.5, 0.4]      — tie on the worst, decided on the second
```

Leximin is the standard refinement of maximin in social choice theory. It cost about five lines.

**Why worst-case rather than average.** Averaging lets a group repeatedly choose venues next door to three people and far from the fourth; that person stops showing up. Leximin is jumpy — a small change for the worst-off participant reorders everything — and that is a feature for the rejection loop, where §12.4 requires the next proposal to be _materially_ different.

The acceptance case, over real coordinates rather than hand-written vectors:

| Venue                                    | leximin vector                             |
| ---------------------------------------- | ------------------------------------------ |
| Next door to three, 9 km from the fourth | `[1.118925, 0, 0, 0]`                      |
| Moderately inconvenient for all four     | `[0.603881, 0.515375, 0.515375, 0.515375]` |

Leximin takes the second. Averaging takes the first.

## ⚠️ This is not travel time

The burden figure is a **deterministic geographic estimate** — a straight line with a correction factor — not a routed journey. **The system does not calculate real driving or travel time, and no comment, UI string, or report claim may say that it does** (§5.4).

The gap is not small, and one of the tests exists to keep it visible: Rothschild to central Jerusalem is about 53 km as the crow flies and roughly 20 km more by road. Google Routes is the upgrade path if real travel time is ever needed; it is deliberately not an MVP dependency.

## The decisions this task took

### A missing origin throws; it never shortens the vector

The single most consequential line in the file after the formula itself.

Leximin compares vectors position by position. A vector one person short does not merely lose information — **it wins comparisons it should lose**, because there is no entry for the person who would have dragged it down. Quietly skipping whoever has not finished onboarding would make them the one person the fairness rule never protects, which is the exact failure §5.4 exists to prevent.

So `originOf` raises `BurdenError("no_origin")`, and the message names the person rather than printing a row id, because it ends up in front of a group of friends: _"Dana has no home location set — someone still needs to fill in their details before this group can be weighed."_

`leximinVector` takes the roster as a parameter rather than inferring it from the burdens, for the same reason: the vector's length is load-bearing, so it is pinned by who is in the group and not by what happened to be in an array.

### The burdens and the roster must describe the same people — checked both ways

The same failure as the one above, arriving through the other door, and it took a question from a reviewer to find it.

`leximinVector` takes the burdens and the roster separately. The obvious check is to walk the roster and make sure everyone has a burden — that catches a person who was never scored. It cannot catch the reverse: a **burden belonging to someone who is no longer in the group**. That vector comes out perfectly well-formed, one entry short, describing a group that is not the group. And a short vector wins comparisons it should lose.

**This is reachable through the ordinary rejection loop, not through misuse.** [B5c](../../tasks/todo.md) marks somebody `cant_make_it` and the meeting returns to weighing, so the roster shrinks between runs of the same meeting. [A8b](../../tasks/todo.md) carries the previous run's ranks 2 and 3 forward into the next run. Burdens computed under one roster meeting the roster of the next run is the normal shape of that loop.

So the check runs in both directions, and there is a test for each.

### A caller mistake is not a data condition — `roster_mismatch`

`BurdenErrorKind` was mixing two categories that must not share a label:

| Kind                                            | Means                                         | A consumer should            |
| ----------------------------------------------- | --------------------------------------------- | ---------------------------- |
| `no_origin`, `bad_tolerance`, `bad_coordinates` | somebody's data is incomplete or broken       | catch it, and say who        |
| `no_viable_slot`                                | this venue is usable at no hour               | catch it, and drop the venue |
| `roster_mismatch`                               | **the code asked a question with no meaning** | never catch it. Fix the code |

The first version of this file gave the roster failures the kind `no_viable_slot`, which set a trap for B7c. The natural handler for `no_viable_slot` is to drop the candidate — the message even invites it — so **a roster bug would have been swallowed as a data condition and a venue would have left the pool in silence.** Spec §4.1g is explicit that narrowing at retrieval is the one thing no later stage can undo.

The kind is what code branches on; the message is only for people. Getting the message right and the kind wrong fixes nothing.

### The detour factor clamps, but the tolerance throws

These look inconsistent and are not:

- **The detour factor is a correction.** Drop a broken one and the answer is still valid, merely uncorrected. So a value below `1.0` — a journey shorter than the straight line between its ends, which is not a thing — clamps up to `1.0`, and so does `NaN`, `Infinity`, and absence.
- **The tolerance is a denominator.** With a broken one there is no answer at all. So zero, negative and non-finite all throw.

A bad parameter therefore costs accuracy or costs the run, never correctness. That asymmetry is the deterministic half of the §4.3 bargain: the worst case of a bad model output is a worse-ranked candidate, never a wrong one.

### A tolerance of `0` is not how you say "immobile"

Rejecting zero closes off an encoding the Context Resolver might otherwise reach for. That state already has a home: **A2's `immobile` violation**, derived from mobility windows ([hard-constraints.md](hard-constraints.md)). A person with no travel mode at all cannot get anywhere whatever the distance, and that is a possibility question, not a distance one.

Two encodings of one fact is how the two halves of the funnel drift apart. **A12's prompt and A13's validation must not emit a zero tolerance.**

### The comparison key is quantised; the comparison is not fuzzed

Leximin only reaches the second-worst participant on an _exact_ tie. With burdens computed from real coordinates, exact equality essentially never happens — `1.1540000000000001` against `1.154` would settle an entire ranking on a difference of 10⁻¹⁶, and the tie-breaking this module exists for would never once fire in production.

The tempting fix is an epsilon inside the comparator. It is worse than the problem: `|a − b| < ε ⟹ equal` is **not transitive**, and a non-transitive comparator handed to `Array.prototype.sort` returns an order that depends on the order it was given. Under §5.4's warning that two identical Places requests are not guaranteed to come back the same way, that makes the shortlist irreproducible run to run.

So the key is rounded to six decimals and compared exactly. `Burden.value` keeps full precision, because that is the number that gets persisted and shown. **Six decimals is floating-point hygiene, not a claim about geographic precision** — home is stored at neighbourhood granularity, so anything below about ten metres is noise regardless.

`straightLineKm` does not round for the same reason, and here it diverges from the private copy frozen in `lib/spike/payload.ts`, which rounds to 100 m for payload readability. Rounding distances manufactures exact ties, and resolving past a tie is the whole job of the sort. **The two functions are not the same function and should not be unified.**

### An exact tie breaks on `placeId`

Not cosmetic. §5.4 records that Google does not guarantee two identical Places requests return the same results in the same order, so leaning on `sort`'s stability would leave the shortlist depending on how the provider happened to answer. Breaking on the id makes the ranking a total function of the data.

### The parameters arrive as arguments, and `BurdenOptions` is a supertype of `ResolvedContext`

§4.1f: the model supplies bounded typed parameters and deterministic code runs unchanged. The detour factor and the per-slot tolerance are those parameters, and this file never reads a model to get them.

`BurdenOptions` is field-for-field a `Partial<ResolvedContext>`, so when A12 lands it passes its whole result in and **not one signature here changes**. The assignability is structural and therefore name-based, so a test asserts it rather than trusting the two type declarations to stay in step.

Until A12 exists, every field is absent and the defaults are the deterministic baseline — factor `1.0`, and each person's own `toleranceKm`. That baseline is not a degraded mode: §4.3 requires it to be exactly what the Resolver falls back to when it is off, times out, or fails validation.

### Point-to-region belongs here; the regions do not

`DetourFactor` is keyed by region pair, and A3 has no regions. But the missing link — which region a point falls in — is pure geometry, so A3 owns it and A12 owns the regions themselves. Neither needs the other to exist.

- **Nearest containing centre wins.** The regions overlap by design: §5.4 puts one query centre on each participant's neighbourhood, and neighbours share ground. Overlap is the normal case, not an edge one.
- **A point in no region gets no correction.** A detour factor is a claim about two _named_ areas; stretching one over a point in neither would be inventing a fact about geography, which is what §4.1f keeps out of this layer.
- **Exact directed pair, then reversed, then `1.0`.** A river with no crossing is the same obstacle both ways and A12 will state it once; a one-way ramp is not, so an exact match must never be overridden by the reverse of another entry.

## Where the line with B7c is

A3 hands over two things that look interchangeable and are not.

| What            | Is                                                                       | For                                  |
| --------------- | ------------------------------------------------------------------------ | ------------------------------------ |
| `score.burdens` | Every `(participant, slot)` cell, at full precision                      | **The gate on `T`**, and persistence |
| `score.leximin` | One number per participant, at their _most permissive_ slot, worst-first | Ranking only                         |

**The gate must run on `burdens`, not on `leximin[0]`.** Gating on the vector would admit a candidate that is reachable at one convenient hour and unreachable at every other — and the agent, which chooses the slot, would then be free to pick one of the others.

The most permissive slot is the right basis for _ranking_ because §5.4 and §4.1g require that time-dependence never narrow what gets retrieved. It is the wrong basis for _dropping_ anything.

Three more things B7c owns and this file deliberately does not: `T`'s value (still open — §13, item 3), the parallel list ranked by rating, and the shortlist fill. `scoreCandidates` therefore returns **input order, unranked**; `rankByLeximin` is a separate call.

**Nothing in this file reads `rating`.** §5.4 rules out weighing kilometres against stars — there is no exchange rate between them, and a weighted sum lets a good rating buy its way past unfairness, which is the thing the section exists to prevent. Fairness gates; above the gate it is advice, and the agent may prefer a better-rated venue (§4.1f).

## What is not decided here

**Origin is not per-slot, and that is F3's decision rather than A3's.** `RecurringMobilityRule` of kind `origin_override` is per-weekday — _"Tuesdays I come from work"_ — which in principle makes the burden's _numerator_ vary with the hour too, not just its denominator. But `Participant.origin` is a single `LatLng`, documented as already resolved (tonight's amendment if there is one, otherwise home).

So the clean statement "distance is slot-independent, only tolerance varies" is true **because of that type**, and a Tuesday-from-work group is currently scored from home. Whoever assembles `Participant` (B7) and whoever writes A12 should know it. Changing it later means turning `Participant.origin` into a resolver, which is a wider blast radius than this task.

**Slot keying is open-coded twice.** A3 needs `` `${start.getTime()}-${end.getTime()}` `` and `constraints.ts` open-codes the same comparison in `checkChosenPair`. Two callers is not yet a helper; B7c will be the third, and that is the moment to extract one.

## What A4 and B7c inherit

1. `scoreCandidates(input, options)` returns `CandidateScore[]` in input order. `CandidateScore` **is** a `ShortlistEntry`, so it persists with no mapping step.
2. `rankByLeximin(scores)` returns a new array, fairest first. It does not mutate.
3. Every failure is a `BurdenError` carrying a `kind` and, where a person's data is at fault, their `participantId`.
4. The whole module is pure — no LLM, no network, no clock, no I/O — so a failing eval scenario stays attributable to a stage (§9).

## A related bug found while building this — [#86](https://github.com/ron14y-sys/squad_lock/issues/86)

Two eval scenarios did not survive contact with the arithmetic they describe. Neither was fixed in A3, because [F5](../../tasks/todo.md) requires all three of us to agree an eval answer and A3 must not be the change that edits its own oracle. Both were agreed and fixed separately; the shape of the mistake is worth keeping.

- **`06-no-perfect-solution-dispersed-group.json` — the expected answer was inverted.** Its trace claimed ~13 km and ~9 km; the haversine over its own coordinates gives 10.45 km and 5.77 km. Those were road distances, not straight lines. Under the formula §5.4 actually commits to, the vectors are `[1.307, 0.006, 0.006]` for Herbert Samuel and `[1.154, 1.154, 0.778]` for Kfar Bat Yam, so leximin picks Kfar Bat Yam. `expected.venue` now says so, which also makes it a sharper scenario: the fair answer is the **lower-rated** venue, and there is no exchange rate between kilometres and stars.
- **`04-semantic-geography-trap.json` — the trap never fired.** It said Left Bank was "straight-line closest to Gili"; Rothschild 12 was closer (4.25 km against 5.23 km), so naive leximin already reached the expected answer with no detour factor at all. The claim was not merely wrong but geometrically impossible — Florentin is strictly farther from Ramat Gan than Rothschild is — so the fix had to move the venue, not restate the prose. The nearer-but-blocked candidate now sits in Shapira at 3.99 km, behind the Ayalon and the railway.

**The lesson is the one that matters here.** Both errors were hand-estimated road distances in a file whose answers are defined on straight lines, and both read as reasonable. The tempting response to the red cell A5 would have shown on 06 is to bend the distance function toward road distance — exactly what the §5.4 warning forbids. So the guard went where the drift happens: `__tests__/eval-scenarios.test.ts` recomputes both scenarios from their own coordinates against this module on every `npm test`. A5 does not exist yet, and a fixture nothing exercises is not verified, merely unread.

## How A3 was verified

`npm run verify` — format, lint, `tsc --noEmit`, and the suite. 52 tests in `lib/matching/distance.test.ts`, including both acceptance tests from the task verbatim, the sphere oracle for the haversine, adversarial coordinates and tolerances, the transitivity of the quantised key, and the `ResolvedContext` wholesale pass as a type-level assertion.

`npm run demo` runs the deterministic ranking end to end, between A2's filter and the agent call.

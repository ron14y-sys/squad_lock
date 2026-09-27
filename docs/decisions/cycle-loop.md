# A8 — Cycle loop: decisions

**Task:** A8 / A8b ([tasks/todo.md](../../tasks/todo.md), [#16](https://github.com/ron14y-sys/squad_lock/issues/16), [#17](https://github.com/ron14y-sys/squad_lock/issues/17), [#125](https://github.com/ron14y-sys/squad_lock/issues/125)) · **Built on:** A2/A3/A4 (the engine), A7 (the correction), B5 (the rejection is stored), B6 (calendars), B7 (venues) · **Inherited by:** A12 (the resolver runs before the search), B11 (amendment batching), C6/C7 (what a person sees)
**Status:** complete. Plan, steps and measurements: [tasks/a8-plan.md](../../tasks/a8-plan.md).

Everything before A8 could answer "what should this group do tonight?" once.
Nothing called it, nothing stored the answer, and nothing knew what to do with
a rejection. A8 is the loop between them:

```
  somebody rejects, in their own words
       ↓  respondToMeeting        → status = weighing, no cycle spent
       ↓  applyRejection (A7)     → a correction, and the sentence, on a context row
       ↓  the feed's next poll    → isDue?  batch window closed, proposal had its time on screen
       ↓  runCycle
            assembleRun   profiles · origins · calendars · Places · the funnel
                          minus every venue and pair already rejected
            runMatchingAgent
            one transaction:  the run · its three options · which contexts it saw
                              status = awaiting · cycleCount · currentDatetime
       ↓
  a new proposal, and a timeline that can say what caused it
```

---

## The decisions

| #   | Decided                                                                                                                                                                   | Why                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **A cycle is a rematch, not a complaint** — `doesnt_suit` spends none; the run that answers it spends one                                                                 | [#125](https://github.com/ron14y-sys/squad_lock/issues/125). Three people rejecting one proposal within a minute used to reach the cap having produced one corrected proposal or none                                                                                                        |
| 2   | **The opening proposal is not a rematch**, so a meeting gets four proposals and all three rejections are answered                                                         | [§3.1](../spec.md) caps "reject-and-rematch cycles" at three. Nobody had rejected anything before the first proposal. §6.3's aside about "cycles 2 and 3" is a remark about caching written against the other reading; §3.1 defines the cap                                                  |
| 3   | `cycleCount` counts rematches, `MatchRun.cycleNumber` counts runs, and they stay one apart                                                                                | `cycleNumber` is unique per `(meetingId, cycleNumber)`, so deriving it from `cycleCount` would collide the moment the two stopped agreeing. It is counted from the runs themselves                                                                                                           |
| 4   | **The feed's own poll is the clock** — `after()` on `GET /api/groups/[id]/meetings`, no cron and no worker                                                                | [§3.2](../spec.md) forbids a background job. C5 already polls every 3s while a meeting is re-weighing, which is the signal, and `maxDuration = 300` is what keeps `after()` alive long enough to finish                                                                                      |
| 5   | **One run at a time, claimed optimistically on `updatedAt`**                                                                                                              | 3s polling against a 6–23s run meant roughly five polls each starting their own run. Only one could ever be written (`cycleNumber` is unique) but all five would pay: five calls out of twenty a day, and five times the Places quota                                                        |
| 6   | **A 90s batching window, measured from the first unanswered rejection** and a 5-minute minimum lifetime per proposal                                                      | A fixed window can be explained to somebody; one that reset on every rejection could slide forever. The lifetime is the half that actually bounds the cap — the wait is longest exactly when the proposal is newest and the rest of the group is most likely still to answer                 |
| 7   | **`MatchRunSeenContext`: every run records which context rows it read**                                                                                                   | A `MatchRun` is stamped when it is _written_, so a rejection made during a run is **older** than the run that never saw it, and no timestamp comparison can tell them apart. Recording what was read answers it exactly. It is also what lets C6's timeline say _why_ a re-weighing happened |
| 8   | **`stuck` belongs to the rejection, not to the run**                                                                                                                      | A run always leaves a meeting `awaiting`, including the third. Flipping to `stuck` as the last proposal lands would hand the group an answer they are not allowed to look at. `stuck` is the moment a re-weighing is _asked for_ and there is none left                                      |
| 9   | **No solution → `stuck`; a fault → `weighing`, with no cycle spent**                                                                                                      | "Your evening is impossible" and "our key expired" are different sentences. A fault leaves the meeting for the next poll, behind a 90s cooldown so "the next poll" is not three seconds later forever                                                                                        |
| 10  | **Two new columns on `participant_meeting_contexts`** — `rejectionText`, `rejectionOutcome` — and a row for every rejection, not only the ones that produced a correction | `Response.reasonText` is **updated**. Somebody who objected three times kept only their third sentence, stamped at the third time, which put it _after_ the re-weighings the first one caused. See the note on `responses` in [database-schema.md](../database-schema.md)                    |
| 11  | **Contexts merge field-wise**, newest wins per field, and `softPreferences` accumulate                                                                                    | "No Asian food", then "and not Italian either" are two facts, not a change of mind. Replacing the object wholesale lost the first one                                                                                                                                                        |

---

## What A8 does not do

- **No amendment batching.** [§3.2](../spec.md)'s window for amendments, and what "the first amendment is free" means once every re-weighing costs a proposal, are B11's. A8 changed only the rejection path, which is why `cycleCount` still carries two meanings — proposals made, and amendment penalties.
- **No widening.** [§4.1g](../spec.md)'s adaptive search is A12's, subject to the widening-only invariant.
- **No notifications.** A person learns of a new proposal by looking, which is what C5's poll is for.

---

## How it is verified, and why not by `npm test`

Every test in this repo runs with no database, no network and no key — a suite
that spends quota is one nobody can afford to run twice. That leaves A8's
actual point unproven, because what could be wrong is not an arithmetic rule
but whether a rejection reaches it at all.

**`npm run verify:a8`** is that half: 27 checks against the real database,
four real matching calls, and **zero Places requests** — `place_search_cache`
and `place_details_cache` are seeded first, so the real funnel runs over real
cache rows rather than being bypassed. It creates its own users, group and
meeting and deletes them in a `finally`, including the neighbourhood-keyed
search rows, which belong to a _location_ and would otherwise outlive
everything else by 30 days.

What it proves that no unit test can: the cap arithmetic end to end
(`cycleCount` 0 → 1 → 2 → 3, `stuck` on the fourth rejection); that a venue
rejected in cycle 1 is still blocked in cycle 4; that every rejection sentence
survives; that `MatchRunSeenContext` grows; and that the two failure paths stay
apart.

Busy blocks are the one thing injected, through `assembleRun`'s only seam.
Places can be neutralised by seeding its cache; a calendar cannot, because
`fetchBusyForUsers` raises for a participant with no usable refresh token **on
purpose** — treating an unread calendar as "free" is the mistake
[§5.7](../spec.md) names.

**`npm run eval -- --followup`** runs the same loop over an eval scenario
(`evals/loop.ts`), which is what replaced a harness that imitated it. ⚠️ Read
the note on `08` in [`evals/judge.ts`](../../evals/judge.ts) before quoting
that number: with two candidate venues and the rejected one blocked, exactly
one survives and the agent cannot answer wrongly. It proves the chain ran, not
that a stated preference changed anybody's mind — and nothing can prove the
second until something fills `VenueSoftFacts`
([#139](https://github.com/ron14y-sys/squad_lock/issues/139)).

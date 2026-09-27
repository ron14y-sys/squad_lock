# A8 + A8b — the cycle loop, and the run that was never wired

Issues [#16](https://github.com/ron14y-sys/squad_lock/issues/16),
[#17](https://github.com/ron14y-sys/squad_lock/issues/17), and
[#125](https://github.com/ron14y-sys/squad_lock/issues/125), which is decided here.

> **Binding constraint on everything below: write every code change in the
> most minimal form possible.** No field, type, helper or parameter without a
> caller in the same commit. Where an existing function can take one more
> line, it takes one more line instead of gaining a sibling.

---

## 1. What this task actually is

Every brick of the matching pipeline exists and is tested. **Nothing lays
them in a row.** `runMatchingAgent` has no caller outside `evals/`,
`scripts/demo-matching.ts` and its own tests, so no meeting has ever received
a proposal, and `lib/db/meeting-detail.ts` returns `proposal: null` for every
meeting in the database.

A8 is therefore two things at once, and they are the same work:

1. **The run** — one function that turns a `meetingId` into a proposal.
2. **The loop** — how many times that may happen, what triggers it, and what
   happens at the cap.

A7 already wrote the run once, in miniature and in memory:
`scenarioFollowupInput` in [`evals/adapter.ts`](../evals/adapter.ts) sets
`cycleNumber: 2`, puts the correction on the rejector's context, filters the
rejected venue out of `viable` and carries the sentence through. It works —
both rejection scenarios reach the agreed follow-up. **A8 replaces that
thirty-line fake with a real one that reads the database, and deletes it.**

---

## 2. The eleven decisions

| #   | Question                           | Decided                                                                                                         |
| --- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | How a cycle is counted (#125)      | **A cycle is a proposal.** `cycleCount` rises when a run is written, never when somebody presses a button       |
| 1b  | What bounds a batch                | `max(first rejection + 90s, proposal published + 5 min)`. Both constants live in the trigger, not in `runCycle` |
| 2   | What starts a run                  | The feed poll C5 already sends, with `after()` so the poll answers instantly                                    |
| 3   | Does A8 wire the **first** run too | **Yes.** Same function, two fields different. Without it there is nothing to reject                             |
| 4   | Shape of the code                  | Two functions: `assembleRun` decides, `runCycle` executes                                                       |
| 5   | Reading a participant's context    | **Field-wise**, newest row that _has_ that field — `softPreferences` included, merged field by field            |
| 6   | Which corrections a run sees       | All of them, accumulated (falls out of 5) — and **every sentence** the person has written, not just the last    |
| 7   | The rejected option                | Filtered out **and** validated afterwards. What is filtered depends on A7's `objection`                         |
| 8   | Ranks 2 and 3                      | Stay in the pool, verified present, never force-inserted                                                        |
| 9   | What a run updates                 | `status`, `cycleCount`, `currentDatetime`, `MatchRunSeenContext` — one transaction with the run                 |
| 10  | Failure                            | **No solution** → `stuck` with a reason. **Fault** → stays `weighing`, logged, retried by the next poll         |
| 11  | Verification                       | A script like `verify:a7-db`, against the real database, with exactly one real Places run at the end            |

### The state machine, in four lines

```
initiate ─────────────► weighing ──[run written]──► awaiting
                           ▲                            │
                           └────[doesnt_suit]───────────┘

weighing + cycleCount = 3   ────────────────────────► stuck
```

`weighing` is what the feed renders as **"שוקלים מחדש"**
([`meeting-cards.ts:43`](../lib/db/meeting-cards.ts)); `awaiting` is
"waiting on you / on others". Today a rejection leaves the meeting in
`awaiting`, so the feed says "waiting on others" while the system is in fact
re-weighing. Step 4 fixes that.

---

## 3. The steps

Each is one commit, and each leaves the repo green.

### Step 1 — the field-wise context read

**File:** `lib/types/participant-meeting-context-from-row.ts` (one new
exported function beside the one already there).

Rows append. An A7 correction row carries `softPreferences` and no origin; an
amendment row carries an origin and no `softPreferences`. Taking the newest
row loses the older one.

```
mergeContexts(rows)  // oldest → newest
  softPreferences  ← every row that has one, merged field by field
  origin + label   ← newest row with either, both from that one row
  mobilityWindows  ← newest row where the array is non-empty
  note             ← newest row where it is not NULL
```

**`softPreferences` merges across fields, and only across fields.** An earlier
draft of this plan replaced the object wholesale, on the reasoning that
"quiet" after "lively" is a change of mind rather than an accumulation. That
is true, and it is about one field. Two corrections usually land on two
different fields — "too loud" at 20:30 and "too expensive" at 21:15 are both
still true — and replacing wholesale drops the first. Merging field by field
gets both cases right: the newest value still wins on a field it repeats.

**`origin` and `originLabel` come from one row, never two.** C7's form lets
somebody type "from work" without dropping a pin, so a label with no
coordinates is a real state; picking the two separately could put one
amendment's label beside another's coordinates.

Pure, no database, fully unit-tested. **This is the only genuinely new
concept in the task** — everything else is wiring.

### Step 2 — `assembleRun`

**File:** `lib/matching/run-cycle.ts` (new).

```
assembleRun(meetingId) → MatchAgentInput
```

Ten reads and calls, in order:

|     | What             | Using                                              |
| --- | ---------------- | -------------------------------------------------- |
| 1   | the meeting      | `occasion`, `cycleCount`                           |
| 2   | the participants | `Response` rows → `User` + `PreferenceProfile`     |
| 3   | their contexts   | step 1's `mergeContexts`                           |
| 4   | each origin      | context origin, else the profile's home            |
| 5   | busy blocks      | `fetchBusyForUsers` (B6)                           |
| 6   | free windows     | `commonFreeWindows` (B6)                           |
| 7   | search centres   | `deriveSearchCentres` (B7b)                        |
| 8   | candidates       | `searchNeighbourhoodCached` per centre (B7)        |
| 9   | opening hours    | `fetchPlaceDetailsCached`, **shortlist only** (B7) |
| 10  | viable + ranked  | `buildShortlist` (B7c)                             |

Nothing here is invented — every line calls something that already exists and
has tests. `cant_make_it` participants are excluded; everyone else is
included whether or not they have answered.

**Why it is its own function:** it returns one object you can print. A script
can show who is participating, where each person starts from, how many
candidates survived and which were dropped and why — **without spending a
Gemini call.** Same split, same reason, as `toMatchRunCreate` /
`persistMatchRun` in [`lib/db/match-run.ts`](../lib/db/match-run.ts).

### Step 3 — the rejection, shaped

Still inside `assembleRun`, which is why it is a separate commit rather than
a separate file.

- **The sentences — and a column, because today they are destroyed.**
  `Response` has one row per `(meeting, user)` and `respondToMeeting`
  _updates_ `reasonText`, so a second rejection overwrites the first. "No
  Asian food" is gone from the database the moment the same person writes
  "no Italian either" — and neither has a `SoftPreferences` field to land in,
  so nothing else remembers them. Both the next proposal and C6's timeline
  are left with one sentence per person, forever.

  So: nullable `rejectionText` **and `rejectionOutcome`** on
  `participant_meeting_contexts`, and A7 writes a row for **every** rejection
  rather than only a `soft` one. Rows append, so the history keeps itself.
  `MatchAgentInput.rejections` becomes `Record<string, string[]>` —
  everything that person has said about this evening, oldest first — and A4's
  prompt line stops saying "the last proposal".

  **Two columns and not one**, because `Response.extractionOutcome` holds
  only the _latest_ outcome for a person — a Response row is that person's
  current state. The block below needs the objection that was raised round by
  round, and without it the rule needs a special case for the newest
  rejection and a weaker rule for every older one. One more column removes a
  case rather than adding one, which is what makes it the smaller change.

  ⚠️ **The trap this drags along**, and it is the A7 bug arriving from the
  other side: `respondToMeeting` counts amendments as rows where
  `softPreferences IS NULL`. A non-`soft` rejection row is also NULL there,
  so it would be counted as an amendment and charge somebody a cycle for
  their free one. The count needs `AND rejectionText IS NULL`.

- **The block** — `findRejectedOption` already returns rank 1 of the latest
  run. What gets removed from `viable` depends on A7's `objection` on the
  same `Response` row:

  | `objection`        | Removed   | Why                                                                                                               |
  | ------------------ | --------- | ----------------------------------------------------------------------------------------------------------------- |
  | `venue_identity`   | the venue | "not that place"                                                                                                  |
  | `soft`             | the venue | too loud, too expensive — a property of the place, and 19:00 does not fix it                                      |
  | `time`             | the pair  | the same venue three hours earlier is the right answer, not a worse one                                           |
  | `distance`         | the pair  | reach genuinely varies by hour — "no car after 21:00" ([#89](https://github.com/ron14y-sys/squad_lock/issues/89)) |
  | `none`, `failed_*` | the pair  | nothing was understood; block the minimum #17 requires and let the sentence do the rest                           |

  And **every** earlier run's rank-1 pair is blocked, not just the last one.
  #17 asks for the option just rejected; doing it for all of them costs
  nothing and closes the case where a venue turned down in cycle 1 comes back
  in cycle 3 as though nobody had said anything.

  Blocked venues come out **before** the Places search, so a venue that may
  not be proposed never costs an Enterprise-tier details call. Blocked pairs
  come out after, because they can only be recognised once the funnel has cut
  the evenings.

- **Ranks 2 and 3** — read back from the previous run and checked to be in
  the new shortlist. One dropped by a deterministic filter (shut, out of
  reach, gated on burden) is **logged and accepted**, never forced back in:
  A2 is the wall, and §4.1b says the model is not where that is re-litigated.

### Step 4 — `runCycle`, the transaction, and the counting move

**One commit, because splitting it leaves the cap broken in between.**

**Files:** `lib/matching/run-cycle.ts`, `lib/db/meetings.ts`.

```ts
const { input, contextIds } = await assembleRun(meetingId);
const { draft, call } = await runMatchingAgent(input);
await prisma.$transaction(async (tx) => {
  await persistMatchRun(draft, call, tx); // the run and its 3 options
  // + MatchRunSeenContext rows for every context this run read
  // + meeting: status = awaiting, cycleCount, currentDatetime
});
```

Four updates, and **each one already has a reader waiting**:

| Update                | Who is waiting                                                    | What it shows today                                  |
| --------------------- | ----------------------------------------------------------------- | ---------------------------------------------------- |
| `status → awaiting`   | the feed                                                          | "re-weighing", forever                               |
| `cycleCount`          | C7, `meeting-detail`                                              | 3 cycles left, forever                               |
| `currentDatetime`     | the feed's sort **and B5b's conflict query, which filters on it** | no date; and no cross-group conflict is ever found   |
| `MatchRunSeenContext` | [`meeting-detail.ts:169`](../lib/db/meeting-detail.ts)            | the timeline never says _why_ a re-weighing happened |

`currentDatetime` needs no timezone conversion, despite B5's note:
`option.proposedDatetime` is already an instant.

**A run always leaves the meeting `awaiting`, the third one included** —
which is a correction to what this plan said before the code was written. The
cap is three _proposals_, and the third is a proposal: flipping to `stuck` as
it lands would hand the group an answer they are not allowed to look at.
`stuck` belongs to the moment a re-weighing is asked for and there is none
left, so it lives in the rejection branch below:

```
created  → weighing
run #1   → proposal 1, awaiting      cycleCount 0   ← not a rematch
reject   → 0 < 3 → weighing
run #2   → proposal 2, awaiting      cycleCount 1
reject   → 1 < 3 → weighing
run #3   → proposal 3, awaiting      cycleCount 2
reject   → 2 < 3 → weighing
run #4   → proposal 4, awaiting      cycleCount 3   ← a real proposal, shown
reject   → 3 ≥ 3 → stuck
```

**Four proposals, and all three rejections answered.** §3.1 caps
"**reject-and-rematch** cycles" at three, and the opening proposal is not one —
nobody had rejected anything. An earlier draft of this plan counted proposals
instead, which quietly refused the third rejection.

So `Meeting.cycleCount` counts **rematches** while `MatchRun.cycleNumber`
counts **runs**, one apart on purpose — which is why `cycleNumber` comes from
the runs themselves rather than from `cycleCount`. `remainingCycles` in
`meeting-detail.ts` then reads correctly the moment the first proposal lands:
three left, not two.

⚠️ **Spec §6.3 has a stale aside** — "cycles 2 and 3 of a meeting are pure
cache hits", written against the other reading. With this it is cycles 2, 3 and 4. §3.1 is where the cap is defined; that line is a remark about caching.

Today, before any of this, it is three _complaints_ and then `stuck`, with
possibly no corrected proposal at all — that is
[#125](https://github.com/ron14y-sys/squad_lock/issues/125).

And in `respondToMeeting`, the `doesnt_suit` branch:

```diff
-        cycleSpent = true;
+        backToWeighing = true;
```

and, after the switch, a status write instead of an increment:

```ts
status: meetingRow.cycleCount >= CYCLE_CAP ? stuck : weighing;
```

The cap is **read** here and **written** by the run.

`assembleRun` also widens to `{ input, contextIds }` — the ids promised a
place in the return type as soon as they had a caller, and
`MatchRunSeenContext` is it.

**Not unit-tested, deliberately.** The rule is one comparison; what could
actually be wrong is whether a rejection reaches it at all, and only a real
database answers that. Step 8's script asserts the whole sequence above.

**The amendment branch is not touched.** A8 wires the rejection trigger;
§3.2's amendment batching window is B11's. Whoever writes B11 inherits one
question this leaves open: under per-run counting, "the first amendment is
free" has to mean something new, because any re-weighing now costs a cycle
whatever caused it. Recorded in §6 below.

### Step 5 — when it cannot answer

**File:** `lib/matching/run-cycle.ts`.

Two outcomes, never one:

| Kind            | Examples                                                                          | Result                                                                                 |
| --------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **No solution** | free windows do not intersect, or the shortlist is empty after the gate           | `stuck` with a reason. This is an answer                                               |
| **Fault**       | no Places key, a participant with no refresh token, the model failed or timed out | stays `weighing`, one `[a8] …` log line, the next poll tries again. Not a wasted cycle |

The same separation A7 made between `failed_quota` and `failed_call`, and the
same shape as [`apply-rejection.ts`](../lib/extraction/apply-rejection.ts). No
new column: if this needs a screen, that is C8b's.

One class, `NoSolutionError`, raised by the three places that genuinely mean
it. Everything else is a fault **by default**, so there is no list of error
types from four other modules to keep up to date.

`runCycle` never throws — its caller is `after()` inside a feed poll, where an
unhandled rejection is another user's request falling over. Failure comes back
as `null` and what it meant is left in the meeting's status.

**A fault costs no cycle, and that needed no code**: step 4 made the run the
thing that counts one, and a run that failed wrote nothing. The order inside
`assembleRun` is what keeps a _repeating_ fault cheap — profiles, origins and
calendars all resolve before the first Places call, so a group that cannot be
weighed is never billed for being retried.

**Not unit-testable, and step 8 is where it is proved.** Both paths are one
`instanceof` over errors raised deep inside database work. The script forces
each with no quota and no model: a group whose calendars are full the whole
window has no shared window and must end `stuck`, and a participant with no
home location is a fault and must leave the meeting in `weighing`.

### Step 6 — the trigger

**Files:** `app/api/groups/[id]/meetings/route.ts` (the `GET` C5 already
polls), `lib/matching/run-cycle.ts`.

```ts
// in the feed GET, after the response is built
after(() => runDueMeetings(groupId));
```

`after` from `next/server`
([docs](../node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md))
runs the callback once the response has been sent, inside the route's
`maxDuration`. The poll stays instant; the run happens behind it; the next
poll, ~3 seconds later, sees the result.

A meeting is due when:

```
status === "weighing"
&& now >= earliest rejection since the last run + REJECTION_BATCH_MS (90s)
&& now >= last run's createdAt          + MIN_PROPOSAL_LIFETIME_MS (5 min)
```

The second clause is what makes the cap mean something. Without it, three
rejections spaced twenty seconds apart produce three proposals nobody read
and a `stuck` meeting in under a minute. With it, **every proposal gets five
minutes on screen**, and the wait is longest exactly when the proposal is
newest — which is when more people are still likely to join the same batch.

Both constants live here, **not** in `runCycle`, so the eval runner and the
verification script call `runCycle` directly and wait for nothing.

**A third constant, and it is not a product rule.** C5 polls every three
seconds while a meeting on screen is `weighing`, and a run takes 6–23 seconds,
so about five polls would each start their own run of the same cycle.
`MatchRun`'s unique `(meetingId, cycleNumber)` means only one could ever be
_written_ — but all five would pay: five calls out of Gemini's twenty a day,
and 120 Enterprise Places calls out of a thousand a month. So a run is claimed
before it starts, with an optimistic lock on `updatedAt`:

```ts
where: { id, status: "weighing", updatedAt: whatWeRead },
data:  { status: "weighing" },   // a write that changes nothing, for the timestamp it moves
```

The conditional `where` makes it atomic — exactly one caller gets
`count === 1` — and the timestamp it moves is what
`RUN_ATTEMPT_COOLDOWN_MS` reads, so a **fault** is not retried three seconds
later for ever either. No new column, no new status.

A browser cannot do this job, though `GroupFeed`'s poll already serialises its
own requests with an `await`: `after()` means the response returns long before
the run ends, and three participants watching the same feed are three
browsers that cannot see each other. "A run is in progress" is shared between
people, so only the database can hold it.

**`maxDuration = 300` on that route**, or the platform kills the `after()`
callback after about ten seconds and the run dies before it writes.

### Step 7 — the first run

**File:** `app/api/groups/[id]/meetings/route.ts` (the `POST`).

```ts
after(() => runCycle(meeting.id));
```

A meeting is created in `weighing` with no run, so `cycleNumber` is 1 and
`rejections` is empty — the same function, two fields different. From here a
new meeting gets a real proposal, and C5, C6 and C7 have content for the
first time.

`runCycle` directly, not `runDueMeetings`: nothing needs batching on a meeting
a second old, and the three timers would only make the initiator wait. Nothing
can collide either — `isDue` leaves a meeting alone for
`RUN_ATTEMPT_COOLDOWN_MS`, by which time this run has set the status. If it
failed, that same cooldown is when the poll retries it, which is exactly what
`isDue`'s "no run at all" branch is for.

`maxDuration = 300` needed no second copy: route segment config applies to the
whole file, so step 6's export already covers this handler.

⚠️ **One piece of copy is now slightly wrong, and it is C10's.** `weighing`
renders through `hebrew-labels.ts` as _"משוקלל מחדש"_ — re-weighed. True of
every cycle after the first and not of the first, which a brand-new meeting now
reaches. Nothing is broken; the word is just one cycle ahead of itself.

### Step 8 — seeing it work, and the one real run

**Files:** `scripts/verify-a8.ts`, `package.json`.

`npm run verify:a8`, on the real database, in the shape of `verify:a7-db`:
creates its own group, meeting and participants, and deletes them in a
`finally`.

1. Print what `assembleRun` produced — participants, origins, windows,
   candidates in, survivors out, drops with reasons. **No Gemini call.**
2. Run cycle 1. Assert a `MatchRun` with three options, `status = awaiting`,
   `cycleCount = 1`, `currentDatetime` set, `MatchRunSeenContext` written.
3. Reject rank 1 in Hebrew. Assert: A7 wrote a correction, `cycleCount` is
   still 1, status is back to `weighing`.
4. Run cycle 2. Assert: the rejected venue is gone, the correction is in the
   payload, ranks 2–3 of cycle 1 are in cycle 2's shortlist, `cycleCount = 2`.
5. Reject twice more. Assert `stuck` at exactly three proposals.
6. `npm run eval -- --followup` still reaches the agreed venue on `07` and
   `08`, now through `runCycle` rather than `scenarioFollowupInput`, which is
   deleted. `classify` drops the `rejection-loop` line and both move from
   `deferred` to `scored`.

**Candidates are injected for runs 1–5.** Exactly one real Places run at the
end, on one neighbourhood, with the call count reported. See §5.

---

## 4. Tests

Everything below needs no database, no network and no key.

| What                                                                                                     | Where                            |
| -------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `mergeContexts`: correction then amendment keeps both; newest wins per field; empty list → `null`        | `lib/types/*.test.ts`            |
| Due-for-run: fresh proposal waits; old proposal waits 90s; `awaiting` is never due; at the cap never due | `lib/matching/run-cycle.test.ts` |
| Three rejections inside one window produce **one** run and **one** cycle (#125's own test line)          | same                             |
| The rejected option is absent from `viable`, per `objection`                                             | same                             |
| Re-proposing the rejected option raises (#17's verify line)                                              | same                             |
| Ranks 2–3 carried forward are present, and a deterministically dropped one is reported, not forced       | same                             |
| No solution → `stuck`; fault → `weighing`                                                                | same                             |

---

## 5. The Places allowance — one budget, three people

The binding tier is **Enterprise: 1,000 requests a month for the whole Google
Cloud project**, shared. `fetchPlaceDetails` (`rating`,
`regularOpeningHours`) is Enterprise and is **one call per shortlisted
place**; `SHORTLIST_SIZE` is 24. **One uncached run can spend 24 of the
1,000** — roughly forty runs a month for all three of us.

1. Every call goes through `searchNeighbourhoodCached` /
   `fetchPlaceDetailsCached`, never the raw client. The caches (30 days, 24
   hours) are what make a repeated run free.
2. No test and no eval touches the Places network. Development runs on
   injected candidates.
3. One deliberate real run, at the end, with the count reported in the PR.

Written into `.env.example` as well, since that is the file everyone opens.

---

## 6. Deliberately not in A8

- **The amendment trigger and its ~90s window** — B11. A8 touches only the
  `doesnt_suit` path. **Open question B11 inherits:** with a cycle now
  costing one proposal, "the first amendment is free" needs a new meaning.
- **A screen for `stuck`** — C8b. A8 produces the state and the reason.
- **Streaming progress** — `onText` exists in A4, but behind `after()` there
  is nobody to stream to. C10.
- **The second half of B7c** — the rating list. Track B.
- **Telling the model to lean less on soft preferences for the opening
  proposal.** Considered and declined. What the request behind it actually
  needs is already true: hard constraints are enforced deterministically by A2
  in every cycle and the model cannot overrule them (§4.1b); every soft field
  is optional, C2 lets each question be declined, and the prompt already
  forbids reading a silence as a preference ([#86](https://github.com/ron14y-sys/squad_lock/issues/86)),
  which scenario `05` measures. The first run already differs from a rematch
  through its data rather than its wording — `tonight_correction` and
  `in_their_own_words` are both `null` — so the lines about them simply do not
  apply. Deliberately weighting a _stated_ preference less on the one proposal
  that has nothing else to go on would make C2's preference game pointless on
  the run it exists for, and would invalidate A5's and A6's measurements for a
  change nothing has shown is needed.
- **The soft-preference vocabulary.** `noiseLevel` cannot be verified from
  any data we hold, and a cuisine _type_ — Italian, Asian, pizza — has no
  field at all, so "not Asian tonight" survives only as the verbatim
  sentence A7 passes to A4. Real, and its own issue: it touches C2's shipped
  preference game, B3, A4's prompt and A7's schema.
- **A per-participant rejection cap.** One person can still spend the group's
  three proposals alone, in about fifteen minutes. §3.1 deliberately has
  three caps, not four — revisit only if it is seen happening.

---

## 7. Known risks

- ✅ **A rejection arriving mid-run** (a run takes 6–23s) — **handled, and not
  the way this plan first said.** "If a rejection was recorded after the run
  began" cannot be asked: a `MatchRun` is stamped when it is _written_, at the
  end, so a rejection made during the run is **older** than the run that never
  saw it. `MatchRunSeenContext` — which step 4 writes anyway — answers it
  exactly: a rejection no run has read is unanswered, whatever its timestamp.
  `runCycle` leaves such a meeting in `weighing`, and `runDueMeetings` asks
  the database for "unseen" rather than filtering by time.
- **Nothing runs if nobody opens the app.** Inherent to a poll-driven
  window, and the price of §3.2's "no cron, no background job".
- **`fetchBusyForUsers` fails the whole computation** when any participant
  has no usable refresh token — deliberate (a false "free" is worse than a
  false "busy"), but it means one unconnected calendar blocks the meeting.
  It is a fault, not `stuck`, so it retries.
- **Live end-to-end still needs the OAuth keys**, which only matter in a
  browser. The verification script injects busy blocks instead.

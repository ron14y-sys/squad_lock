# A7 — Constraint Updater: decisions

**Task:** A7 ([tasks/todo.md](../../tasks/todo.md), [#15](https://github.com/ron14y-sys/squad_lock/issues/15)) · **Built on:** A1 (the client), A2/A3/A4 (the engine), A6 (the justification rules), B5 (the rejection is already stored) · **Inherited by:** A8 (the loop), A8b (the blocked pair), A12 (its twin), B11 (assembles a run), C6 (renders the timeline)
**Status:** complete. Plan and measurements: [tasks/a7-plan.md](../../tasks/a7-plan.md).

A free-text rejection becomes a structured correction on the rejecting
participant's `ParticipantMeetingContext` — for this meeting, never a profile
edit ([spec §2.2.1](../spec.md), [#86](https://github.com/ron14y-sys/squad_lock/issues/86)).

```
  "רועש לי מדי שם, משהו שקט יותר"
       ↓  one extraction call, ~3s, $0.0002
  { softPreferences: { noiseLevel: "quiet" }, objection: "soft" }
       ↓
  a correction row, and an outcome on the response
       ↓
  the next weighing sees the correction AND the sentence it came from
```

---

## The ten decisions

| #   | Decided                                                                                                     | Why                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The closed `SoftPreferences` vocabulary, plus one `objection` classification                                | Matching is a field comparison, not a translation between two invented word lists (#86). The classification is what distinguishes "no reason given" from "the reason was distance, which is A12's material"                                                                                                                                                                                                     |
| 2   | Nothing extracted still means a new run: the rejected pair is blocked, and the **verbatim** text goes to A4 | D9 — a pre-computed rank cannot address an objection it never saw. [§4.1a](../spec.md) permits free text at the human boundary, so the stronger model reads the words even when the extractor found no field. Serving a stored rank 2 was considered and rejected: it is a snapshot of a roster and a set of burdens that may have moved, and it breaks A6's coverage check when somebody has since dropped out |
| 3   | A7 owns the column, the migration and the write                                                             | Otherwise A7 is a function nobody calls. B11 inherits the column rather than owning it                                                                                                                                                                                                                                                                                                                          |
| 4   | The call runs immediately **after** `respondToMeeting`'s transaction commits                                | An LLM call inside `prisma.$transaction` holds a connection for up to a minute. Batching, if any, is A8's question                                                                                                                                                                                                                                                                                              |
| 5   | A failed call falls back to exactly the pre-A7 behaviour, and records the outcome as a fact                 | By then the rejection is committed and the cycle is spent, so failing the request would make the person press again and spend a second cycle. Silence is worse: the product's whole claim is that it listened                                                                                                                                                                                                   |
| 6   | A4 is shown the correction **and** the sentence, as two fields, never merged                                | Success criterion 4 asks for a proposal that _visibly_ addresses the stated reason. A silent field-wise merge leaves the model nothing to point at, and some objections reduce to no field at all                                                                                                                                                                                                               |
| 7   | A7 sees the rejection text and the rejected option — never the candidate list                               | Enough to tell what "too loud" refers to. A component that sees candidates is choosing a venue ([§4.1f](../spec.md))                                                                                                                                                                                                                                                                                            |
| 8   | Its own table, separate from `npm run eval`'s pass rate                                                     | "The right constraint came out" and "the right proposal came out" are different claims, and only the second is what §12.5 counts                                                                                                                                                                                                                                                                                |
| 9   | `gemini-3.5-flash-lite`, per [spec §6.4](../spec.md)                                                        | A second provider is a new external dependency ("ask first", §10) and a second price table. `todo.md` and issue #15 named Haiku from before the 2026-08-26 provider change; both are corrected                                                                                                                                                                                                                  |
| 10  | `lib/extraction/`, one file                                                                                 | A12 is the twin and runs _before_ the search, so `lib/matching/` would be the wrong home for it ([D7](design-decisions.md)). The shared conventions get extracted when there is a second caller, not before                                                                                                                                                                                                     |

---

## What the guard rails refuse

All of it against hand-written answers, with no key and no quota
([spec §9](../spec.md): the LLM layers are tested at their guard rails, not at
the model).

- **An invented field fails.** `z.strictObject`, so it is refused rather than
  quietly stripped — the #86 rule enforced in code and not only asked for in
  the prompt.
- **An invented value fails**, and so does an objection outside the five.
- **The two halves of an answer must agree.** `soft` with nothing stated, or a
  stated preference filed under `distance`, are both rejected. The first
  records a cycle as answered when nothing was captured; the second would have
  the timeline explain something the person never said.
- **An omitted `soft_preferences` is read as an empty one.** The same
  statement, no retry, and failing a run over the difference would spend a
  cycle to say nothing.
- **A rejection with no text never reaches the model at all.**

## What is recorded, and why it is a fact rather than a sentence

`Response.extractionOutcome` — one enum, both axes, because they are mutually
exclusive. Five values say what kind of objection it was; three say why there
was no answer, and they are A1's own taxonomy because each has a different fix:
`failed_quota` is the free tier's allowance and a routine outcome, `failed_call`
never came back, `failed_invalid` came back unusable.

The Hebrew line a person reads is rendered at display time, the same rule
`MatchOption.unverified` follows ([hard-constraints.md](hard-constraints.md)).

## Two bugs this task would otherwise have introduced

1. **A correction row would have spent somebody's one free amendment.**
   `respondToMeeting` counts context rows to decide whether an amendment is the
   free one (§3.1), and A7 appends to the same table. The count is narrowed to
   rows where `softPreferences` is null. Verified against Postgres, not only
   against the type system — `Prisma.DbNull` semantics on a JSON column are
   exactly the kind of thing that is right in one and wrong in the other.
2. **Reading a context back is field-wise, not row-wise.** Rows append; an A7
   row carries a correction and no origin, an amendment row carries an origin
   and no correction. **B11 must resolve each field from the latest row that
   has it**, not from the latest row.

## What A8 inherits

- **The loop itself**: the cap, `stuck`, persistence of the new run, and
  whether rejections batch the way amendments do.
- **`scenarioFollowupInput` goes away.** It makes the three changes A8 will
  make for real — the correction on the context, the rejected venue gone, the
  words carried — and exists only so criterion 4 can be shown before A8.
- **`classify` still defers `07` and `08`.** Deleting that line is A8's, not
  A7's: the follow-up harness is not the loop.
- **How a cycle is counted** is open and filed as
  [#125](https://github.com/ron14y-sys/squad_lock/issues/125): today every
  `doesnt_suit` spends one, so three people rejecting the same proposal within
  a minute exhaust the cap having produced one corrected proposal or none.

## Measured

**Extraction, 24 Sep 2026:** 8 of 8 cases correct, every one 3/3 across three
runs, $0.0047 over 24 calls, 2.4–4.8s each. `npm run eval:constraints`.

**The corrected cycle, end to end:** both rejection scenarios produce the
follow-up we agreed on — `07` to Quiet Corner at 21:00–00:00 from a live
extraction, `08` to Tzafta. `npm run eval -- --followup`.

**The database half:** eight checks against the real Postgres,
`npm run verify:a7-db`.

**One fixture was wrong and the model found it.** `vague` read "לא בא לי **שם**"
and expected `none`; the answer was `venue_identity`, three times out of three,
and it was right — _שם_ points at the place. The text was fixed rather than the
expectation, and `evals/rejections.json` records why.

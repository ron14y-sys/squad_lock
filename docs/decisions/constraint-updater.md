# A7 — Constraint Updater: decisions

**Task:** A7 ([tasks/todo.md](../../tasks/todo.md), [#15](https://github.com/ron14y-sys/squad_lock/issues/15)) · **Built on:** A1 (the client), A2/A3/A4 (the engine), A6 (the justification rules), B5 (the rejection is already stored) · **Inherited by:** A8 (the loop), A8b (the blocked pair), A12 (its twin), B11 (assembles a run), C6 (renders the timeline)
**Status:** complete. Plan and measurements: [tasks/a7-plan.md](../../tasks/a7-plan.md).

A free-text rejection becomes a structured correction on the rejecting
participant's `ParticipantMeetingContext` — for this meeting, never a profile
edit ([spec §2.2.1](../spec.md), [#86](https://github.com/ron14y-sys/squad_lock/issues/86)).

```
  "רחוק לי מדי, ובא לי בר"
       ↓  one extraction call, ~3s, $0.0002
  { softPreferences: { venueKinds: ["bar"] }, distance: { kind: "closer" },
    start: null, notThisPlace: false, untranslated: null, objection: "soft" }
       ↓
  a correction row, and an outcome on the response
       ↓
  the next weighing sees the correction AND the sentence it came from
```

---

## The ten decisions

| #   | Decided                                                                                                                                            | Why                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The closed `SoftPreferences` vocabulary, plus one `objection` classification                                                                       | Matching is a field comparison, not a translation between two invented word lists (#86). The classification is what distinguishes "no reason given" from "the reason was distance". Since #220 code derives it from the fields (`objectionOf`) rather than the model choosing it — see below                                                                                                                    |
| 2   | Nothing extracted still means a new run: the rejected venue is blocked (only the pair, when the call failed), and the **verbatim** text goes to A4 | D9 — a pre-computed rank cannot address an objection it never saw. [§4.1a](../spec.md) permits free text at the human boundary, so the stronger model reads the words even when the extractor found no field. Serving a stored rank 2 was considered and rejected: it is a snapshot of a roster and a set of burdens that may have moved, and it breaks A6's coverage check when somebody has since dropped out |
| 3   | A7 owns the column, the migration and the write                                                                                                    | Otherwise A7 is a function nobody calls. B11 inherits the column rather than owning it                                                                                                                                                                                                                                                                                                                          |
| 4   | The call runs immediately **after** `respondToMeeting`'s transaction commits                                                                       | An LLM call inside `prisma.$transaction` holds a connection for up to a minute. Batching, if any, is A8's question                                                                                                                                                                                                                                                                                              |
| 5   | A failed call falls back to exactly the pre-A7 behaviour, and records the outcome as a fact                                                        | By then the rejection is committed and the cycle is spent, so failing the request would make the person press again and spend a second cycle. Silence is worse: the product's whole claim is that it listened                                                                                                                                                                                                   |
| 6   | A4 is shown the correction **and** the sentence, as two fields, never merged                                                                       | Success criterion 4 asks for a proposal that _visibly_ addresses the stated reason. A silent field-wise merge leaves the model nothing to point at, and some objections reduce to no field at all                                                                                                                                                                                                               |
| 7   | A7 sees the rejection text and the rejected option — never the candidate list                                                                      | Enough to tell what "too expensive" refers to. A component that sees candidates is choosing a venue ([§4.1f](../spec.md))                                                                                                                                                                                                                                                                                       |
| 8   | Its own table, separate from `npm run eval`'s pass rate                                                                                            | "The right constraint came out" and "the right proposal came out" are different claims, and only the second is what §12.5 counts                                                                                                                                                                                                                                                                                |
| 9   | `gemini-3.5-flash-lite`, per [spec §6.4](../spec.md)                                                                                               | A second provider is a new external dependency ("ask first", §10) and a second price table. `todo.md` and issue #15 named Haiku from before the 2026-08-26 provider change; both are corrected                                                                                                                                                                                                                  |
| 10  | `lib/extraction/`, one file                                                                                                                        | A12 is the twin and runs _before_ the search, so `lib/matching/` would be the wrong home for it ([D7](design-decisions.md)). The shared conventions get extracted when there is a second caller, not before                                                                                                                                                                                                     |

---

## What the guard rails refuse

All of it against hand-written answers, with no key and no quota
([spec §9](../spec.md): the LLM layers are tested at their guard rails, not at
the model).

- **An invented field fails.** `z.strictObject`, so it is refused rather than
  quietly stripped — the #86 rule enforced in code and not only asked for in
  the prompt.
- **An invented value fails**, and so does a `max_km` outside 0.3–50 or a
  start that is not `HH:MM`.
- **The objection cannot disagree with the fields, because code derives it.**
  Before #220 the model chose it, and `soft` with nothing stated, or a stated
  preference filed under `distance`, were both refused. Asking for one label
  made the model drop every fact but one, so `objectionOf` now reads it off
  the fields: a stated want, then "not this place", then distance, then time,
  then `none`.
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
   rows where `softPreferences` is null — and, since every rejection writes a
   row (#220), where `rejectionText` is null too. Verified against Postgres, not only
   against the type system — `Prisma.DbNull` semantics on a JSON column are
   exactly the kind of thing that is right in one and wrong in the other.
2. **Reading a context back is field-wise, not row-wise.** Rows append; an A7
   row carries a correction and no origin, an amendment row carries an origin
   and no correction. **B11 must resolve each field from the latest row that
   has it**, not from the latest row.

## Any rejection becomes facts the weighing acts on — [#220](https://github.com/ron14y-sys/squad_lock/issues/220)

The first version read one label per rejection, and only a `soft` one changed
anything the engine weighed. "Too far" and "too late" were classified and then
left to A12. **Now one sentence yields every fact it holds, and each lands on a
lever.**

| Field             | Holds                                                                                              | Becomes                                          |
| ----------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `softPreferences` | `budget`, `venueKinds`, `cuisines`, and in a tonight correction `avoidVenueKinds`, `avoidCuisines` | the correction, field by field over the profile  |
| `distance`        | `{ kind: "closer" }`, or `{ kind: "max_km", km }` only when the person wrote a number              | `toleranceKm` for this meeting                   |
| `start`           | `direction` ("earlier" / "later"), or `notBefore` / `notAfter` only when the person wrote a time   | `earliestStart` / `latestStart` for this meeting |
| `notThisPlace`    | the place as such                                                                                  | the venue blocked                                |
| `untranslated`    | what no field can hold ("wants parking"), in a few words                                           | stored, so the missing levers can be counted     |

The vocabulary is [lib/preferences/vocabulary.ts](../../lib/preferences/vocabulary.ts);
`TonightCorrection` is in [lib/types/profile.ts](../../lib/types/profile.ts).

**The model returns a number only when the person wrote one; otherwise a
direction. Code turns the direction into this meeting's number** —
[§4.1f](../spec.md), the model sets parameters and code runs the function.
[lib/extraction/tonight-bounds.ts](../../lib/extraction/tonight-bounds.ts):

- **"Closer"** is `CLOSER_FACTOR` (0.8) of the smaller of the rejected venue's
  distance from this person and their current tolerance, never below
  `MIN_TOLERANCE_KM` (0.5). It always tightens, by a step large enough to move
  the ranking. With no origin or no venue location to measure from, no number
  is set and the venue block does the work.
- **"Earlier" / "later"** is `START_STEP_MS` (30 minutes) before or after the
  rejected start, in local time. A time the person wrote wins over a direction.

The values are written onto `ParticipantMeetingContext` — `toleranceKm`,
`earliestStart`, `latestStart`, `untranslated` — by `recordRejectionOutcome` in
[lib/db/meetings.ts](../../lib/db/meetings.ts), and resolved field-wise like
everything else. `assembleRun` ([lib/matching/run-cycle.ts](../../lib/matching/run-cycle.ts))
applies them: tonight's `toleranceKm` replaces the profile's, and the time
before `earliestStart` becomes busy, so an evening is moved later rather than
dropped. `latestStart` is checked by A2 as an `unavailable` violation
([lib/matching/constraints.ts](../../lib/matching/constraints.ts)). A4 is told
both bounds, and that the tolerance was set tonight.

**What a rejection takes off the table** (`blockedByRejections`; every earlier
proposal's exact pair is blocked regardless):

| Outcome                              | Blocked   |
| ------------------------------------ | --------- |
| `soft`, `venue_identity`, `distance` | the venue |
| `none`                               | the venue |
| `time`                               | the pair  |
| `failed_*`, or no outcome            | the pair  |

A distance rejection blocks the venue because it is as far at every hour;
blocking only the pair let it come straight back an hour later
([#211](https://github.com/ron14y-sys/squad_lock/issues/211)).

**`untranslated` is stored and shown nowhere yet.** The sentence itself still
reaches A4 verbatim; the field exists so the levers people miss can be counted.

**An avoid does not drop a venue that also answers what the same person asked
for.** `answersRequest` in [lib/matching/requests.ts](../../lib/matching/requests.ts):
avoid means "not only that". "A bar, not a restaurant" keeps a bar that serves
food, which carries both types in Google's data. The extraction keeps the
literal avoid; keeping the bar is the matcher's rule, not the prompt's.

**Measured:** four sweeps of [evals/rejections.json](../../evals/rejections.json)
against Gemini, 36 calls each, went 75% → 67% → 83% → **92%** after prompt
tuning (a7242b1). `not_this_place` became optional in the wire schema — required,
the model said true to "I'd like sushi, not the usual" three times in three.
Still flaky: "יותר בר מאשר מסעדה" adds an avoid one time in three.
`npm run eval:constraints` ([scripts/run-constraint-evals.ts](../../scripts/run-constraint-evals.ts)).

## A rejection by ticking reasons — [#244](https://github.com/ron14y-sys/squad_lock/pull/244)

A rejection may be made by ticking what was wrong: the style of place, the
food, too far, the hour (with the start that would suit), too expensive. **The
ticks become the same `ConstraintUpdate` with no model call**
(`constraintUpdateFromLabels` in [lib/extraction/labelled-rejection.ts](../../lib/extraction/labelled-rejection.ts)),
so `toleranceFor`, `startBoundsFor`, `recordRejectionOutcome` and
`blockedByRejections` are unchanged.

- A ticked style or food is an avoid; "too expensive" is budget `modest`; "too
  far" is `closer`.
- The hour is a direction decided by comparison with the rejected start: later
  is `notBefore`, earlier is `notAfter`, the same hour says nothing.
- `sentenceFromLabels` ([lib/extraction/rejection-labels.ts](../../lib/extraction/rejection-labels.ts))
  writes the ticks as one Hebrew sentence, stored as the rejection's words so
  the timeline and the next weighing read it like any other.
- Something the engine cannot act on is not a tick. It goes in the free-text
  box, and through A7.

The respond route calls `applyLabelledRejection` and `applyRejection`
([lib/extraction/apply-rejection.ts](../../lib/extraction/apply-rejection.ts))
when both are given, **each recorded as its own row**. A ticked rejection whose
row cannot be written is recorded as `failed_call`, not `none`, so no venue is
blocked on the strength of a row that never said what it was about.

**`none` now blocks the venue** (2c9aa12). A rejection read as saying nothing
the engine could use — "סתם" — held nothing about the hour either, so the only
thing known is that this place was turned down. Blocking just the pair let the
same venue come back at another time with nothing changed. A failed read still
blocks only the pair: nothing was read, so there is no reason to hide a venue.

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

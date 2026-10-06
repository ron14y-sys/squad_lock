# Bug log

One entry per bug found in use or in manual testing: what was seen, why it
happened, how it was fixed, and what now proves it stays fixed. Newest first.

This is the **incident** record. When a bug turns out to be an instance of a
mistake this project keeps making, its entry links to the class in
[lessons.md](lessons.md), which is where the general rule lives.

**Adding an entry:** copy the template, fill every field, and write "not yet"
rather than leaving a field out. An entry with no test is still an entry — it
says so.

```
## <short title> — <date found>

- **Seen:** what the person saw, in their words if possible
- **Cause:** the line(s) responsible, and why they were written that way
- **Fix:** what changed — PR link
- **Proof:** the test that fails without the fix, or "not yet"
- **Still open:** anything the fix deliberately left, or "nothing"
```

---

## The preference game forgot earlier answers — 2026-10-06

- **Seen:** answers given in the preference game "were not saved". Replaying
  the game showed every question blank, and nothing anywhere showed what had
  been chosen.
- **Cause:** two things together.
  - `PreferenceGame` always started from `answers = {}` and its container never
    loaded the saved profile, so the game had no idea what was already stored.
  - The save sends the whole `softPreferences` object, and the API replaces the
    column with it. Replaying the game and skipping a question therefore
    _erased_ the answer given to that question before — without the person
    ever seeing it.

  No screen displayed soft preferences, so "erased" and "never saved" looked
  the same from outside.

- **Fix:** [#203](https://github.com/ron14y-sys/squad_lock/pull/203). The game
  loads `/api/preferences` first and starts from it; the saved card is marked
  "הבחירה שלך עד עכשיו"; with a saved answer, skip reads "דלג — השאר כמו שהיה"
  and keeps it (decided: skipping never clears a saved answer); the closing
  screen and the profile page both list the four answers.
- **Proof:** `PreferenceGameContainer.test.tsx` — "a replayed game starts from
  the saved answers, and skipping keeps them" fails on the old code (it saved
  `{}`). `HardConstraintsForm.test.tsx` — the profile summary test.
- **Still open:** the same report also said hard constraints were lost. Nothing
  in the code deletes or overwrites them — the forms save only their own fields
  and the API updates only what it is sent. The leading explanation is looking
  at a different database than the one saved to (a Vercel Preview URL runs
  against staging since #157, `squadlock.vercel.app` against production). Not
  confirmed.

## A confirmed meeting never warned against a clash — 2026-09-30

- **Seen:** found while wiring meeting confirmation, not by a user. A dinner
  confirmed at 19:00 in one group gave no warning against a proposal at 20:00
  in another, and approving it double-booked the person.
- **Cause:** `findConflictingMeetings` (`lib/db/conflict-dismissal.ts`)
  filtered candidates to `OPEN_MEETING_STATUSES`, which excludes `closed`. It
  was written before any meeting could reach `closed`, so the filter was
  harmless then — and became wrong, silently, the day confirmation shipped.
- **Fix:** [#201](https://github.com/ron14y-sys/squad_lock/pull/201). Confirmed
  meetings take part, in pairs with at least one open meeting. The warning says
  approving will not cancel the confirmed one and offers no "change the other
  one"; `cancelConflictingMeetings` still never touches a confirmed meeting.
- **Proof:** `__tests__/confirmed-conflict-db.test.ts` — "pairs a confirmed
  meeting with an open one" fails on the old code. A `ConflictWarning` test for
  the confirmed wording fails against the old component.
- **Still open:** nothing.

## An approval carried over to the next proposal — 2026-09-30

- **Seen:** found while writing the manual test sheet
  ([#176](https://github.com/ron14y-sys/squad_lock/issues/176)). B approves
  proposal 1, C rejects it, proposal 2 arrives somewhere else — and B is still
  "approved". If the others approve, the meeting closes on a place B never saw;
  B gets no email and the feed shows nothing waiting on them.
- **Cause:** a `Response` row holds a person's answer but not _which proposal_
  it answered, and nothing reset it when a new proposal was written. The
  closing check counted every `approved` row. Same family as
  [lessons.md](lessons.md)'s rule on updated rows: a row that is a _state_ was
  being read as though it were tied to one moment.
- **Fix:** [#200](https://github.com/ron14y-sys/squad_lock/pull/200).
  `weigh()` resets every response except `cant_make_it` to `pending` in the
  same transaction that writes the new proposal. `doesnt_suit` resets too; its
  sentence stays on its `participant_meeting_contexts` row, which the timeline
  reads.
- **Proof:** `__tests__/response-reset-db.test.ts` — fails on the old code with
  `expected 'approved' to be 'pending'`. That `weigh()` calls the reset is read
  in the code, not tested.
- **Still open:** a stale click — approving after a new proposal landed but
  before the page refreshed — approves the new one. Planned as a follow-up.
  Earlier approvals no longer appear in the timeline (accepted).

---

## Before this log

Found through the manual test sheet on 2026-09-30 and fixed before this file
existed. Cause and fix are in each issue and PR.

| Bug                                                                          | Issue                                                       | Fixed in                                                  |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------- |
| The 404 page was Next.js's default, in English                               | [#190](https://github.com/ron14y-sys/squad_lock/issues/190) | [#191](https://github.com/ron14y-sys/squad_lock/pull/191) |
| Timeline showed the raw transport value: "אין car הערב"                      | [#175](https://github.com/ron14y-sys/squad_lock/issues/175) | [#178](https://github.com/ron14y-sys/squad_lock/pull/178) |
| Group size 3–6 was not enforced                                              | [#174](https://github.com/ron14y-sys/squad_lock/issues/174) | [#180](https://github.com/ron14y-sys/squad_lock/pull/180) |
| New users were never taken through onboarding                                | [#173](https://github.com/ron14y-sys/squad_lock/issues/173) | [#179](https://github.com/ron14y-sys/squad_lock/pull/179) |
| Venue search returned only restaurants                                       | [#165](https://github.com/ron14y-sys/squad_lock/issues/165) | [#177](https://github.com/ron14y-sys/squad_lock/pull/177) |
| Opening a meeting failed on the live site                                    | [#154](https://github.com/ron14y-sys/squad_lock/issues/154) | see the issue                                             |
| A profile's home coordinates were never written, so nothing could be weighed | [#132](https://github.com/ron14y-sys/squad_lock/issues/132) | see the issue                                             |

## Known and not yet fixed

- **Signing out opens NextAuth's default page, in English** — `התנתק` links to
  `/api/auth/signout`, and `auth.ts` sets a custom page only for sign-in.
  ([#171](https://github.com/ron14y-sys/squad_lock/issues/171))
- **"חבר מחדש" for a disconnected calendar may not reconnect** — suspected from
  reading, not seen: the link goes to `/api/auth/signin`, sign-in's page is
  `/`, and `/` sends a signed-in user to `/groups`. Test 14.4 on the manual
  test sheet checks it.
- **Stale click approves an unseen proposal** — see the #176 entry above.

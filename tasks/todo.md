# Backlog — SquadLock

Tasks derived from [tasks/plan.md](plan.md). Detailed through **Milestone 1 (Week 3)**; Milestone 2 work is detailed where the design decisions fixed it and sketched where they did not.

**IDs:** `F` foundation (shared) · `A` matching agent · `B` data/auth/calendar · `C` UI. Assign one track per person.

> **Revised for the 8-week schedule** and for the design decisions in [spec §4.3](../docs/spec.md), [§5.4](../docs/spec.md), [§5.6](../docs/spec.md) and [§5.7](../docs/spec.md): leximin fairness, a Context Resolver supplying parameters, a burden gate with two parallel ranked lists, opening hours as a hard constraint, adaptive polling, and a third response control.

**Every task:** completable in one focused session, touches ~5 files or fewer, has a check that does not depend on another track.

**Nothing is cut.** Every task below is in scope on the 8-week schedule. The Context Resolver is the one item deliberately given slack — it ships dark behind a fallback, so a slip there costs nothing. See [plan.md](plan.md).

---

## Week 1 — Foundation (all three, together)

- [x] ~~**F1 — Decide venue provider**~~ — **Resolved: Google Places.**

- [x] **F1b — Email Easy (easy.co.il) about API access**
  - Acceptance: an email asking for API access for an academic project, describing the use case. One hour of work with a potentially large payoff.
  - Verify: email sent, date recorded. **Do not wait for a reply and do not scrape** — build on Google Places regardless
  - Files: `docs/decisions/venue-provider.md`

- [x] **F2 — Measure a matching run against the Vercel function timeout**
  - Acceptance: a streamed route makes one real LLM call over a ~20-candidate payload and reports wall-clock time; the plan's function timeout is written down next to it. Blocks A4.
  - Verify: the spike completes without being killed, with margin against the limit
  - Files: `docs/decisions/runtime-budget.md`, one spike route

- [x] **F3 — Shared types**
  - Acceptance: types for `PreferenceProfile`, `Meeting`, `MatchRun`, `MatchOption`, `Response`, `ParticipantMeetingContext`, `ResolvedContext`. Includes the **status vocabulary as a union** — `waiting_on_you` / `waiting_on_others` / `reweighing` / `conflicting` / `stuck` / `closed` — and **three** response kinds: `approved`, `cant_make_it`, `doesnt_suit`, plus the amendment which is not a response at all. **Distance and tolerance signatures are time-aware from day one** — tolerance is per time slot, not a scalar (spec §5.4).
  - Verify: `npm run build` passes; each track has imported at least one type
  - Files: `lib/types/*.ts`
  - Note: the time-aware signature is the single most expensive thing to retrofit. Put it in now even while every value is a constant.

- [x] **F4 — Database schema and migrations**
  - Acceptance: all entities from spec §6.2, including the sparse **`ParticipantMeetingContext`** and **`ConflictDismissal`**, plus `PreferenceProfile.tolerance_km` and the recurring mobility rules, and `Meeting.occasion`. **`Meeting` indexed by participant and scheduled time.**
  - Verify: migration runs clean on an empty database; rollback works; `EXPLAIN` on "all open meetings for user X" uses the index
  - Files: schema and migration files

- [x] **F5 — Eval set**
  - Acceptance: 8–12 scenarios with profiles, calendars, the agreed-correct answer and its reasoning. At least 2 with no perfect solution · at least 2 with a rejection reason and expected follow-up · **1 hard-constraint trap** · **1 closed-on-the-night trap** · **1 mobility-window trap** where the answer is a _(venue, time)_ pair · **1 semantic-geography trap** (spec §9).
  - Verify: all three agree each answer is right
  - Files: `evals/scenarios/*.json`, `evals/README.md`
  - Distances in a scenario are **straight lines computed from its own coordinates**, never road distances estimated by hand — that is how [#86](https://github.com/ron14y-sys/squad_lock/issues/86) happened. `__tests__/eval-scenarios.test.ts` recomputes 04 and 06 on every `npm test`.
  - The shortest meeting worth proposing is **three hours**; a scenario must leave its expected venue at least that after its hours trim the group's window.
  - The shortest meeting worth proposing is **three hours**, in both places it can be measured: the group's own free window, and the slot left after a venue's hours and everyone's reach have narrowed it.
  - All eight traps agreed and verified by `__tests__/eval-scenarios.test.ts` on every `npm test`. The six design questions the fixtures could not answer are settled in [#86](https://github.com/ron14y-sys/squad_lock/issues/86).

- [x] **F6 — Deployed skeleton** — live on Vercel, mobile-first shell, installable. Verify on a real phone.
- [x] **F7 — Secrets and environment** — `.env.example` committed, nothing secret ever committed. Verify: `git log -p | grep -iE 'sk-ant|AIza|client_secret'` is empty.

---

## Track A — Matching Agent, Rejection Loop and Context Resolver

### Milestone 1 (weeks 2–3)

- [x] **A1 — Gemini client and cost logging**
  - Acceptance: thin wrapper over `@google/genai` logging input, output and **thought** tokens plus dollar cost per call. Model by env var — `gemini-3.6-flash` for matching, `gemini-3.5-flash-lite` for the two extraction components (spec §6.4).
  - Note: thought tokens are spent from `max_output_tokens` and dwarf the answer — size the cap for both, and treat a stream that ends without a completion event as truncated, not malformed. Measured in [F2](../docs/decisions/runtime-budget.md).
  - Files: `lib/llm/client.ts`, `lib/llm/cost.ts`
  - Decisions and the contracts A4, A5, A7, A10 and A12 inherit: [docs/decisions/llm-client.md](../docs/decisions/llm-client.md)

- [x] **A2 — Hard-constraint filter and post-check** — merged in #77.
  - Acceptance: a pure function dropping every candidate violating a hard constraint, and a second re-checking the agent's answer. **Both operate on `(venue, time slot)` pairs**, so they also enforce opening hours and each participant's mobility window (spec §5.4). Deterministic.
  - Verify: unit tests — the highest-rated venue violating a constraint is removed; a venue closed at the proposed hour is removed but survives at another hour; a fabricated agent answer violating either is caught
  - Note: build this **before A4**. It is the guardrail the single-agent design leans on.
  - Files: `lib/matching/constraints.ts`, tests
  - Decisions, and what A4 and B7c inherit: [docs/decisions/hard-constraints.md](../docs/decisions/hard-constraints.md)

- [x] **A3 — Leximin fairness scoring**
  - Acceptance: `burden = straight_line × detour_factor / tolerance_km` per participant per candidate, then **leximin** — sort burdens worst-first and compare lexicographically. Detour factor and tolerance arrive **as parameters**, defaulting to 1.0 and the profile value. Pure function, no LLM.
  - Verify: unit tests — a venue next door to three and an hour from the fourth loses to a moderately inconvenient one for everyone; **and two candidates tying on the worst-off participant are separated by the second-worst**
  - Files: `lib/matching/distance.ts`, tests
  - Decisions, and what A4, B7c, A12 and A13 inherit: [docs/decisions/leximin-fairness.md](../docs/decisions/leximin-fairness.md)
  - Found while building it: **two eval scenarios contradicted their own coordinates** — 06's expected answer was inverted and 04's trap did not fire. Filed as [#86](https://github.com/ron14y-sys/squad_lock/issues/86) against F5, fixed separately, and guarded by `__tests__/eval-scenarios.test.ts` so prose cannot drift from the numbers again.

- [x] **A4 — Group Matching Agent**
  - Acceptance: one call over all profiles, availability and the shortlist returns a **schema-validated ranked top 3** (spec §4.1c). Each option carries a `(venue, datetime)` pair, a per-participant justification, and — internally — what it trades away and for whom. No free-text parsing. Runs the A2 post-check before returning. The whole run is persisted.
  - Verify: a malformed response is rejected rather than accepted; runs end to end on one eval scenario
  - **A missing soft preference must change nothing.** Every `SoftPreferences` field is optional, and not having an opinion is not the same as wanting either answer — an absent field may never cost an option a place or win it one, and may never be described in a justification as though it were a choice ([#86](https://github.com/ron14y-sys/squad_lock/issues/86)). Nothing deterministic branches on `softPreferences`, so this obligation is the prompt's and A6's.
  - **Venue soft facts arrive beside the candidate**, not inside it — `VenueSoftFacts`, in the same `SoftPreferences` vocabulary the participants use, so matching is a field comparison.
  - **Unverified candidates** (decided at A2): a pair carries `unverified` when its opening hours or a dietary tag could not be checked. The agent **strongly prefers pairs with nothing unverified**, and when it falls back to one, the proposal carries an asterisk telling the person to ring ahead and confirm. Never phrase it as what the option cost them (§5.6). See [docs/decisions/hard-constraints.md](../docs/decisions/hard-constraints.md)
  - Files: `lib/matching/agent.ts`, `lib/matching/schemas.ts`, `lib/db/match-run.ts`, `evals/adapter.ts`
  - Decisions, and what A5, A6, A7 and B11 inherit: [docs/decisions/matching-agent.md](../docs/decisions/matching-agent.md)
  - **The model does not write the "ring ahead" note.** A2 already knows what could not be checked, so code writes the sentence and the model is only told which pairs are verified — preferring one is a judgement, stating the fact is not (spec §4.4).
  - **What could not be verified is stored as a fact, not a sentence.** `MatchOption.unverified` holds A2's `UnverifiedFact[]`; the Hebrew "ring ahead" line the group reads is `unverifiedNote` in `lib/format/hebrew-labels.ts`, rendered at display time — the same rule `WEEKDAY_LABELS` follows.
  - **Two things B6 would have broken are already fixed**: the slot lookup derives from `viable` rather than a second list that could disagree with it, and `MatchOption.proposedEnd` exists so a meeting that shortens to fit a venue can say so. Both were one line now and a backfill later.
  - The post-check runs on **all three** options, not just rank 1: ranks 2 and 3 are persisted, shown as "we also considered", and carried into the next cycle by A8b.
  - ⚠️ **The migration adding the cost columns and `MatchOption.unverified` has not been applied to any database** — there is none in dev or CI. Whoever holds the connection string runs `npm run db:migrate:deploy`.

- [x] **A5 — Eval runner** — `npm run eval` prints pass rate, cost, duration, cycles and hard-constraint violations per scenario. Violations column must be zero.
  - **First live sweep, 9 Sep 2026: 3 scored, 3 passed, 0 hard-constraint violations, $0.0092, 12–23s per scenario.** Full table and the decisions in [docs/decisions/eval-runner.md](../docs/decisions/eval-runner.md); the plan is [tasks/a5-plan.md](a5-plan.md).
  - **Five of eight scenarios are waiting on a stage, not on the model.** `03` and `05` on **B6**, `07` and `08` on **A7/A8**, and — found by the first sweep — `04` on **A12**: its own `expected.reasoning` says a straight-line-only engine is expected to pick the other venue, so without the Context Resolver's detour factor nothing could reach the agreed answer. The classification moved; the eval answer did not. `classify` in `evals/judge.ts` derives all of it from `trap` and `needsTrim`, so each becomes scored on its own when its stage lands.
  - **`--replay <dir>` re-judges a recorded sweep with no call.** 20 requests a day is the binding constraint on this task, so everything except the measurement was built against a recording. Answers land in `evals/runs/` (gitignored).
  - **Not a CI gate**, deliberately: it spends real quota and a model's judgement is not a thing to block a PR on. The exit code enforces the one hard invariant — non-zero on a violation or an error, never on the pass rate.
  - `cycles` prints 1 for every row until A8 spends one. Spec §12 asks for the column, so it is printed rather than omitted.
  - Files: `evals/judge.ts`, `scripts/run-evals.ts`, `__tests__/eval-judge.test.ts`

- [ ] **A6 — Per-participant justification quality**
  - A4 left this space deliberately empty. It already rejects a justification addressed to somebody **not** in the meeting — only an answer can get that wrong — and leaves the mirror case, a participant left out, entirely to A6 along with its test. The validation hook is `validateOptions` in `lib/matching/agent.ts`.
  - Acceptance: every option names every confirmed participant; a run omitting someone fails validation. **Justifications carry no comparative cost line** (spec §5.6) — an option's trade-off data is persisted for the timeline and the report, never rendered to the person who bore it.
  - Verify: an agent response covering 5 of 6 participants is rejected

### Milestone 2 (weeks 4–6)

- [ ] **A7 — Constraint Updater: free-text rejection → structured constraint** — the project's central mechanism. Haiku 4.5. Shares prompt, schema and validation conventions with A12.
  - What it writes: a **per-meeting correction** on the rejecting participant's `ParticipantMeetingContext`, in `SoftPreferences` vocabulary — never an edit to the profile. "Too expensive this time" does not make somebody permanently thrifty, and a per-meeting row records whose objection it was and which re-weighing it triggered. Decided on [#86](https://github.com/ron14y-sys/squad_lock/issues/86); scenarios `07` and `08` are the worked examples. Depends on B11's column.
- [ ] **A8 — Cycle loop with cap; new run from updated constraints** — cap 3, then `stuck`.
- [ ] **A8b — Rejection re-run behaviour** _(decision resolved — implementation only)_
  - Acceptance: a rejection **always** triggers a new run. The previous run's ranks 2 and 3 **stay in the candidate pool** and compete again under the updated constraint, with justifications regenerated. **The option just rejected may not be re-proposed** — if it is, that is a validation failure signalling A7 did not capture the objection (spec §9).
  - Verify: unit test asserting carried-forward candidates are present in the next shortlist, and that re-proposing the rejected option raises
- [ ] **A10 — Model and effort check against the eval set** — can Haiku 4.5 hold six profiles without dropping one? Reduced from a full sweep.
- [ ] **A12 — Context Resolver** _(the designated slip item — ships dark)_
  - Acceptance: one Haiku call per meeting, before the search, returning a validated `ResolvedContext`: `tolerance_km` per participant **per time window**, `origin` + `originSource`, `extraRegions`, `detours` per region pair, `noViableRegion`. Never sees a venue, never returns a distance (spec §4.1f).
  - Verify: runs on the semantic-geography eval scenario and produces a merged region and a detour factor
- [ ] **A13 — Resolver validation, clamp and fallback**
  - Acceptance: every number clamped to its range; every region centre inside a sanity bounding box; **the widened union always contains the deterministic baseline** (spec §4.1g); any failure — call, timeout, malformed, failed validation — falls back to exactly the pre-Resolver behaviour.
  - Verify: unit tests with **adversarial fabricated outputs** — a coordinate in the sea, a 500 km radius, a negative tolerance, a detour factor below 1.0 — plus the invariant and the fallback path
- [ ] **A14 — Eval with the Resolver on and off** — report the delta. This is what turns the §4.3 decision into a measured result.

---

## Track B — Data, Auth and Calendar

### Milestone 1 (weeks 2–3)

- [x] **B1 — Postgres provisioned and connected** — real database in dev and on Vercel; F4 migrations applied; health endpoint. Merged in #78 (Supabase Postgres, `lib/db/client.ts`, `/api/health`). `DATABASE_URL` added to Vercel (Production); `https://squadlock.vercel.app/api/health` confirmed returning `{"status":"ok","db":"connected"}`.
- [x] **B2 — Google sign-in** — a `User` row is created. **Scope `calendar.freebusy` only** — availability without event content (spec §5.2). **Start Week 2.** Merged in #79 (`auth.ts`, Auth.js v5, no adapter — the `signIn` callback upserts `User` directly since the schema keeps googleId/googleRefreshToken as plain fields rather than Account/Session tables).
  - `calendar.freebusy` confirmed non-sensitive in the Cloud Console (decision D13); scope verified end-to-end against both the temporary dev project and the shared `squad-lock` project — a `User` row is created correctly in both.
  - ⚠️ Still open: the shared `squad-lock` project's OAuth consent screen is still in **Testing** status (test users only, 7-day refresh-token expiry) — publishing **In production** is the one step left to fully satisfy the "token still works 8 days after it was issued" verify line above.
  - Verify: the consent screen lists only the free/busy scope; a token still works 8 days after it was issued
- [x] **B3 — Preference profile persistence** — hard constraints, soft preferences, **`tolerance_km`** and the **recurring mobility rules** (spec §5.1) save and load per user. Merged in #82 (`app/api/preferences/route.ts`, `lib/preferences/schema.ts`, `lib/types/preference-profile-from-row.ts`). C3's `HardConstraintsForm` and the location form now call it directly and are covered by their own tests.
- [x] **B4 — Groups and membership** — create, invite by email, accept, list. Four routes: `POST /api/groups`, `POST /api/groups/[id]/invitations`, `POST /api/invitations/[token]/accept`, `GET /api/groups`.
  - `Invitation` is a separate model from `GroupMember`, keyed on email rather than userId — per the spec's own success criteria the invitee has no `User` row yet when the invite is sent, and only gets one at accept time (B2's sign-in).
  - The real email send is B8's job (Resend); accepting works off the invitation's token today whether or not that email exists yet.
  - ⚠️ API only — no screen calls any of these four routes yet (no "create group" or "invite" UI exists). Verifiable directly today only by calling the endpoints, not by clicking through the app.
- [x] **B5 — Meetings and responses** — initiate with any subset of date/time/venue/occasion (the all-blank case is the default path), and respond: approve, "I can't make it", "something doesn't work for me" (+ free text), or the amendment ("my situation tonight is different"). Two routes: `POST /api/groups/[id]/meetings`, `POST /api/meetings/[id]/respond`. Merged in #95, #96 (`lib/db/meetings.ts`, `lib/meetings/schema.ts`, `lib/types/participant-meeting-context-from-row.ts`); #97 fixed a type drift against a `ParticipantMeetingContext` field merged concurrently from #86/#90.
  - Both caps enforced server-side in `lib/db/meetings.ts`: 3 open meetings per group (`initiateMeeting`), and 1 free amendment per participant per meeting — the second and later amendments spend a cycle, same as `doesnt_suit` (`respondToMeeting`). Reaching the 3-cycle cap flips the meeting to `stuck` (spec §3.1).
  - `currentDatetime` is deliberately left unset by `initiateMeeting` even when a full pinned date+time is given — see that function's own comment. Whichever task first reads it (the feed, most likely) is where the `APP_TIME_ZONE` conversion belongs.
  - Re-weighing after a spent cycle (the batching window, the agent call) is B11's job, not this one's.
  - ⚠️ API only — no screen calls either route yet.
- [x] **B5b — Cross-group conflict query** — `findConflictingMeetings(userId)` in `lib/db/conflict-dismissal.ts` (merged in #99): every pair of a user's own open meetings, across every group, on the same calendar day in `APP_TIME_ZONE` and less than 4 hours apart, with any `ConflictDismissal`ed pair left out. A pure query plus a pure overlap function (`meetingsConflict`), no LLM.
  - `canonicalMeetingPair` puts a pair of meeting ids into `ConflictDismissal`'s ordered unique-constraint order — used by the lookup here, and meant for any future insert too.
  - Excludes meetings with no `currentDatetime` yet at the query itself — nothing proposed, nothing to conflict on. Since nothing populates that column yet (see B5's own note), this is correct today but has nothing live to find until matching (Track A) exists.
  - The auto-cancellation this feeds (approving one conflicting meeting cancels the other, in one transaction) is B5c's job; the warning strip and its two escape hatches are C6's.

### Milestone 2 (weeks 4–6)

- [x] **B5c — Conflict cancellation as one transaction** — approving A cancels colliding B **in a single transaction across both**; B **returns to weighing** with the approving user marked `cant_make_it`, never deleted. `cancelConflictingMeetings` in `lib/db/meetings.ts` (merged in #101), inside the same `tx` as the approval, reusing `meetingsConflict`/`canonicalMeetingPair` from B5b.
  - `RespondToMeetingResult.cancelledConflicts: Meeting[]` carries the cancelled meetings back to the caller.
  - ⚠️ Not independently verified against a mid-write failure — no test in this repo touches a real database (same gap as B5's other `lib/db` functions). The atomicity claim rests on everything living inside one `prisma.$transaction` callback, checked by reading the code, not by a test that forces a failure partway through.
- [ ] **B6 — Google Calendar read and availability**
  - Acceptance: free slots common to all confirmed participants, **intersected with venue opening hours and mobility windows** to produce viable `(venue, time)` pairs (spec §5.4). Empty intersection → `stuck`, not a bad proposal.
  - **The shortest meeting worth proposing is three hours**, applied in both places: a group free window under three hours is `stuck` with a reason, and a `(venue, time)` pair narrowed under three hours is dropped — one pair, not the run (decided on [#86](https://github.com/ron14y-sys/squad_lock/issues/86)).
  - **Mobility narrows a slot, it does not forbid a venue.** Compose `reachCapKm` (A2) into a `SlotTolerance`: `min(profile.toleranceKm, cap ?? Infinity)`. On foot the reach is about a kilometre; transit and car are uncapped ([#89](https://github.com/ron14y-sys/squad_lock/issues/89)). **This must be deterministic here, not in A12** — the Resolver ships dark and falls back, so a Resolver-only version hands a car-sized tolerance back to someone who cannot drive every time it is off.
- [ ] **B7 — Google Places with two-tier caching**
  - Acceptance: **one query per participant neighbourhood, deduplicated** — not one wide bounding query, because a result cap makes a wider area mean worse coverage per participant (spec §5.4). Returns coordinates, **opening hours and `businessStatus`** for every result. **Search results cached long and keyed by rounded neighbourhood coordinates**, so the cache is shared across meetings and users; **hours cached briefly and fetched only for the shortlist.**
  - Verify: the same neighbourhood queried from two different meetings makes one outbound call; a permanently-closed venue never reaches a proposal; hours are not served from a week-old cache
  - ⚠️ **The $200 monthly credit was withdrawn on 1 Mar 2025.** The allowance is now per SKU tier: 10,000 Essentials / 5,000 Pro / **1,000 Enterprise** per month, and a request is billed at the **highest tier any requested field belongs to**. `location` is Essentials, `businessStatus` is Pro, but **`regularOpeningHours` and `rating` are Enterprise** — so **never put them in the wide search field mask**. Search on cheap fields; fetch Enterprise fields only for the ~20 on the shortlist (spec §6.3)
  - Verify: measure real Enterprise-tier call counts against the 1,000/month allowance in Week 2, rather than assuming
- [ ] **B7b — Search area: union of neighbourhoods, expanded by centres** — union of each participant's neighbourhood plus a radius; **not a centroid**. Adaptive expansion **adds query centres rather than enlarging the radius** (spec §5.4), and accepts `extraRegions` from A12 subject to the widening-only invariant. Verify on your own three addresses: real restaurants, no park, no sea.
- [ ] **B7c — Candidate funnel: gate and dual-list fill**
  - Acceptance: dedupe → drop hard-constraint and closed-at-time violations → **gate on `burden > T`** → **top N/2 by leximin + top N/2 by rating, overlap freeing slots** → shortlist of **20–24**, each entry carrying its per-participant distances and its viable time slots. Pre-rank uses each participant's **most permissive** window so time-dependence never narrows retrieval. Deterministic.
  - Verify: a hard-constraint violator never reaches the shortlist however good its rating; both lists are represented; the shortlist is ≤ N and every entry has one distance per participant
- [ ] **B8 — Transactional email via Resend: invitations and notifications**
  - Acceptance: mail sent from a **dedicated project address**, never a participant's mailbox (spec §6.3). Fires only on the five state changes in §5.5 — invitation · a proposal waiting on you · meeting confirmed · your meeting returned to weighing after a conflict · `stuck`. **Never on a re-weighing or an individual response**
  - Verify: three cycles across a meeting produce **one** email per person, not three; the From address is the project's, not the initiator's
  - Depends on: B12 (verified sending domain)
  - Free tier: 3,000/month, 100/day — roughly a hundred times what a group of six needs

- [ ] **B12 — Buy a domain and verify it for sending**
  - Acceptance: a domain is registered and its DNS records are verified with Resend, so mail sends from the project's own address.
  - **Do this in Week 1, not Week 5.** It is ~$10–15/year — the only item in the project that costs real money — and DNS verification has a waiting period that does not care about milestone dates. It blocks B8, and B8 blocks the "friend receives an emailed link" success criterion (§12.1)
  - Verify: a test message arrives from the project address and does not land in spam
- [ ] **B9 — Retry and error handling on external calls**
- [ ] **B11 — Per-meeting context: persistence and batching** — ⚠️ also adds `softPreferences Json @default("{}")` to `participant_meeting_contexts` and its migration: `ParticipantMeetingContext.softPreferences` exists in `lib/types/meeting.ts` with **no column behind it**, and it is where a rejection lands (A7, [#86](https://github.com/ron14y-sys/squad_lock/issues/86)). Write `ParticipantMeetingContext`; open a **~90-second batching window** that further amendments reset; the window is closed by the next feed poll, so **no cron and no background job** (spec §3.2). Verify two amendments 30 seconds apart produce exactly one run.
  - **This is where B5 hands over to A4.** `respondToMeeting` already spends the cycle and flips to `stuck` at the cap; what it does not do is re-run the match. `runMatchingAgent` + `persistMatchRun` are the two calls B11 needs — a `MatchRun` row needs its `Meeting` row, which B5 now creates. See [docs/decisions/matching-agent.md](../docs/decisions/matching-agent.md).
  - Whoever writes the first `currentDatetime` value takes the `APP_TIME_ZONE` conversion B5 deliberately left alone. The rank-1 option's `proposedDatetime` is already an instant, so a run is the cheapest place to set it.

---

## Track C — UI and Product Flow

### Milestone 1 (weeks 2–3)

- [x] **C1 — Mobile-first shell and navigation** — designed for a phone, not a shrunk desktop layout. Merged in #74 (`app/layout.tsx`, `app/_components/AppHeader.tsx`, `app/manifest.ts`, safe-area CSS in `app/globals.css`).
- [x] **C2 — Preference game** — this-or-that questions producing a soft-preference set in **under 60 seconds**, timed on someone who has not seen it. Merged in #75 (`app/onboarding/preferences/PreferenceGame.tsx`).
  - **Every question can be declined**, and declining stores nothing for that field rather than a default. `SoftPreferences` fields are all optional and an absent one changes nothing downstream; forcing four answers manufactures opinions nobody holds ([#86](https://github.com/ron14y-sys/squad_lock/issues/86)). Merged in #109 (`PreferenceGameContainer.tsx`), which also wired the game up to actually save — `onComplete` had existed since #75 but nothing had ever called it — and fixed `softPreferencesSchema` requiring all four fields when the type behind it had already gone optional.
- [x] **C3 — Hard constraints screen** — kosher, allergies, fixed unavailable hours. Explicit, never inferred. Merged in #83 (`app/profile/HardConstraintsForm.tsx`), calling B3's `PATCH /api/preferences` directly.
- [x] **C3b — Home location, travel tolerance and recurring mobility**
  - Acceptance: home at **neighbourhood granularity, not a street address**, with the privacy framing visible. Tolerance as a **labelled slider** ("on foot · the neighbourhood · half the city · anywhere") **storing kilometres**. Recurring rules — "no car on Fridays" — set here, because most of what varies is predictable and belongs in the profile rather than in a correction (spec §5.1).
  - Verify: reload persists; the stored location is not a precise address; the stored tolerance is a number in km
  - Merged in #84 (`app/profile/location/LocationForm.tsx`). No device-location permission dialog — home is typed at neighbourhood granularity, never read from the device (see `docs/onboarding-flow.md`).
- [x] **C4 — Group creation and invite** — merged in #94 (`app/groups/GroupsList.tsx`, `app/groups/[id]/GroupDetail.tsx`). Also added the `GET` side B4 hadn't needed yet (`GET /api/groups/[id]/invitations`) and the invitation-acceptance page that was otherwise entirely missing (`app/invitations/[token]/AcceptInvitation.tsx`, calling B4's `POST /api/invitations/[token]/accept`).
- [x] **C5 — Group feed**
  - Acceptance: cards **sorted by date, nearest first**, past below a divider; date block, status label, mini avatars, one-line summary. A row awaiting the viewer is findable while scanning mid-list. Initiate button disabled at the cap **with an explanation**. **Adaptive polling: ~3s while a meeting on screen is re-weighing, ~30s otherwise, off in the background** (spec §5.6). The same poll closes the amendment batching window.
  - Verify: with 3 open meetings, someone who has not seen the app names which one needs them **without opening anything**
  - Merged in #107 (`app/groups/[id]/GroupFeed.tsx`, `lib/db/meeting-cards.ts`). Also added the `GET` side B5 hadn't needed yet (`GET /api/groups/[id]/meetings`) and `deriveMeetingCardStatus`, the per-viewer status derivation `lib/types/meeting.ts`'s `MeetingCardStatusInput` contract described but nobody had written yet.
  - **"The same poll closes the amendment batching window" is not wired up yet** — that half needs B11's `runMatchingAgent`/`persistMatchRun` to exist first. Whoever ships B11 calls it from this same `GET` handler; nothing here does it today.
  - Cards show the proposed instant (`currentDatetime`), not a time range: nothing in the schema stores a meeting's end time until B11 sets `currentDatetime` for real (see B11's own note above) and B6 exists to reason about duration. No duration was invented to fill the gap.
- [ ] **C5b — Initiate a meeting** — one button; optional date/time/venue and an **occasion note**, but the all-blank case is the default path, not a degraded one.
- [ ] **C6 — Meeting screen: the three blocks**
  - Acceptance: (1) the proposal with an expandable **"why this suits you"** written for the viewer — **and no comparative cost line** (spec §5.6); (2) **"where it stands"** — progress, one-line summary, every participant with state and timestamp, including those who dropped out; (3) **"what happened so far"** — proposals, rejections and reasons, **which amendment triggered a re-weighing**, and what was passed over.
  - Verify: two accounts see two different personal justifications; neither is told what the proposal cost them relative to an alternative; the dropped-out participant is still listed
- [ ] **C7 — The three response controls**
  - Acceptance: approve · "I can't make it" · "something here doesn't work for me" · **"my situation tonight is different"**. The third opens free text and shows the remaining cycle count; the fourth opens the per-meeting context form.
  - Verify: **only "something doesn't work" decrements the cycle counter** — neither "I can't make it" nor an amendment does

### Milestone 2 (weeks 4–6)

- [ ] **C8 — All-groups screen and conflict warnings**
  - Acceptance: every group with a count of what awaits the user, plus one timeline of all open meetings across groups. Conflicts surface in **three** places: a feed banner, a `conflicting` row label, and a warning strip **directly above the approve button**. The strip offers **two ways out** — _"these don't clash — keep both"_ (persisted as a `ConflictDismissal`) and _"one of these needs to change"_. Exact shape of the two controls to be refined when built.
  - Verify: a user with colliding meetings cannot reach approve without passing the warning; approving shows what happens to the other meeting **before** the press; a dismissal survives a reload and the next poll
- [ ] **C8b — The `stuck` state has a screen** — best option found, why it stopped, and a way for the group to settle it. It does not silently vanish from the feed.

### Weeks 7–8

- [ ] **C10 — Empty, loading and error states across every screen** — including visible progress throughout a matching run.
- [ ] **C11 — Full pass on a real phone with a stranger, no help given** — success criterion 9.

---

## Milestone 1 — Week 3

**Gate:** the full flow runs end to end on the live URL with fabricated venues and simplified profiles.

- [ ] Create a group with 3 real accounts
- [ ] Initiate a get-together with no date, time, or venue
- [ ] The matching run completes inside the measured timeout budget
- [ ] A proposal card appears in the feed for all three, **each seeing why it works for them** — and none of them told what it cost them
- [ ] The meeting screen shows all three blocks
- [ ] All response controls work, and **only one of them spends a cycle**
- [ ] Two meetings run in the same group at once, sorted by date
- [ ] The feed updates within seconds of a run finishing, without a page reload
- [ ] The eval set runs and reports a pass rate with **zero hard-constraint violations**

**Nothing moves to post-milestone work until every box above is checked.**

## Milestone 2 — Week 6

**Gate:** the same flow with real restaurants, real calendars, and a working rejection loop.

- [ ] Real venues with real opening hours; a closed or closed-down restaurant is never proposed
- [ ] Real calendar availability, intersected with hours and mobility windows
- [ ] **A free-text rejection produces a materially different next proposal that visibly addresses the stated reason**
- [ ] A user in **two** groups with colliding meetings is warned before approving either, and can dismiss a false positive
- [ ] Approving one **returns the other to weighing rather than deleting it**
- [ ] The eval set passes ≥ 80% including the rejection-loop scenarios, with zero hard-constraint violations
- [ ] A run completes in ≤ 20 seconds with visible progress
- [ ] _(if reached)_ The eval set has been run with the Context Resolver on and off, and the delta is written down

---

## Immediate next step

Assign a track per person, then all three do Week 1 together. **F2 first** — it blocks A4. **F1b on day one** — the reply arrives on Easy's schedule. Within Track A, **A2 before A4**: the hard-constraint filter is the guardrail the single-agent design depends on, and building the agent first invites trusting it with things it should never have been trusted with.

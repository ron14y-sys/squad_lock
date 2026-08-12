# Backlog — SquadLock

Tasks derived from [tasks/plan.md](plan.md). Detailed through **Milestone 1** (Week 4–5); work beyond it is sketched and gets broken down once the thin slice lands — estimating it now would be fiction.

**IDs:** `F` foundation (shared) · `A` matching agent · `B` data/auth/calendar · `C` UI. Assign one track per person.

> **Revised 2026-08-12** for the architecture change in [spec §4.2](../docs/spec.md) — one Group Matching Agent instead of personal agents negotiating — and for the interface decisions in [spec §5.6–5.7](../docs/spec.md): a feed of meeting cards, several meetings in parallel, and conflict detection across groups.

**Every task:** completable in one focused session, touches ~5 files or fewer, has a check that does not depend on another track.

---

## Week 1 — Foundation (all three, together)

- [x] ~~**F1 — Decide venue provider**~~ — **Resolved: Google Places.** Supplies venue data and the coordinates the distance calculation needs; free credit covers development and the demo.

- [ ] **F1b — Email Easy (easy.co.il) about API access**
  - Acceptance: an email sent asking for API access for an academic project, describing the use case. One hour of work with a potentially large payoff — their restaurant filters (kosher type, vegetarian, vegan, child-friendly, atmosphere) map to our constraints better than Google's do.
  - Verify: email sent, date recorded in the decision note. **Do not wait for a reply and do not scrape** — build on Google Places regardless
  - Files: `docs/decisions/venue-provider.md`

- [ ] **F2 — Measure a matching run against the Vercel function timeout**
  - Acceptance: a streamed route makes one real LLM call over a ~15-candidate payload and reports wall-clock time; the chosen plan's function timeout is written down next to it. Much smaller than the background-job decision this replaces — spec §4.1e. Blocks A4.
  - Verify: the spike route completes without being killed, and the measured worst case has margin against the limit. If it does not, that is when a background job comes back on the table
  - Files: `docs/decisions/runtime-budget.md`, one spike route

- [ ] **F3 — Shared types**
  - Acceptance: TypeScript types for `PreferenceProfile`, `Meeting`, `MatchRun`, `MatchOption`, `Response`. Includes the **status vocabulary as a union type** — `waiting_on_you` / `waiting_on_others` / `reweighing` / `conflicting` / `stuck` / `closed` — and the two rejection kinds as distinct values, not a boolean plus a note. Every track imports these and no track defines its own.
  - Verify: `npm run build` passes; each track has imported at least one type
  - Files: `lib/types/*.ts`

- [ ] **F4 — Database schema and migrations**
  - Acceptance: all entities from spec §6.2 exist as migrations and run against a real Postgres instance. **`Meeting` is indexed by participant and scheduled time**, not only by group — the cross-group conflict query depends on it (spec §5.7) and retrofitting the index means migrating every row.
  - Verify: migration runs clean on an empty database; rollback works; `EXPLAIN` on "all open meetings for user X" uses the index rather than a sequential scan
  - Files: schema and migration files

- [ ] **F5 — Eval set**
  - Acceptance: 8–12 scenarios, each with participant profiles, calendars, the agreed-correct answer, and its reasoning. At least 2 with no perfect solution; at least 2 including a rejection reason and the expected follow-up proposal; **at least 1 hard-constraint trap** where the otherwise-best venue violates someone's hard constraint (spec §9).
  - Verify: all three agree each answer is right — disagreement here means the scenario is underspecified, which is the point of writing them
  - Note: the eval set is architecture-independent by design. It describes correct answers, not how they are reached, so it survived the §4.2 change untouched and would make an eventual multi-agent comparison fair.
  - Files: `evals/scenarios/*.json`, `evals/README.md`

- [ ] **F6 — Deployed skeleton**
  - Acceptance: the app is live on Vercel at a shareable URL, mobile-first shell, installable to home screen
  - Verify: open the URL on a phone, add to home screen, it opens standalone
  - Files: `app/layout.tsx`, `app/page.tsx`, `public/manifest.json`

- [ ] **F7 — Secrets and environment**
  - Acceptance: `.env.local` gitignored, `.env.example` committed, all keys in Vercel env vars. No secret has ever been committed.
  - Verify: `git log -p | grep -iE 'sk-ant|AIza|client_secret'` returns nothing
  - Files: `.gitignore`, `.env.example`

---

## Track A — Matching Agent and Rejection Loop

- [ ] **A1 — Anthropic client and cost logging**
  - Acceptance: a thin wrapper over the TypeScript SDK that logs tokens and computed dollar cost for every call. Model configurable by env var (`claude-sonnet-5` for the matching agent, `claude-haiku-4-5` for extraction — spec §6.4).
  - Verify: a hello-world call returns text and writes a cost line
  - Files: `lib/llm/client.ts`, `lib/llm/cost.ts`

- [ ] **A2 — Hard-constraint filter and post-check**
  - Acceptance: a pure function that, given participant profiles and a candidate list, drops every candidate violating any hard constraint — plus a second function that re-checks a chosen option against all profiles after the agent answers. Both deterministic. Spec §4.1b.
  - Verify: unit tests, including the trap case — the highest-rated venue in the list violates one participant's constraint and is removed; and a fabricated agent answer that violates a constraint is caught by the post-check
  - Note: build this **before** A4. It is the guardrail the whole single-agent design leans on.
  - Files: `lib/matching/constraints.ts`, tests

- [ ] **A3 — Distance fairness scoring**
  - Acceptance: straight-line distance from each participant's home to each candidate produces a per-candidate fairness score that **minimizes the worst burden rather than the average** (spec §5.4). A participant's travel tolerance weights their own term. Pure function, no LLM.
  - Verify: unit test where a venue next door to three participants and an hour from the fourth loses to a moderately inconvenient venue for everyone
  - Files: `lib/matching/distance.ts`, tests

- [ ] **A4 — Group Matching Agent**
  - Acceptance: given all participants' profiles, their availability, and a filtered shortlist with distances attached, one call returns a **schema-validated ranked top 3** (spec §4.1c). Each option carries a datetime, a per-participant justification, and an explicit statement of what it trades away. No free-text parsing anywhere. Runs the A2 post-check on its answer before returning.
  - Verify: unit test asserting a malformed response is rejected rather than silently accepted; runs end to end on one eval scenario; the full run is persisted
  - Files: `lib/matching/agent.ts`, `lib/matching/schemas.ts`

- [ ] **A5 — Eval runner**
  - Acceptance: one command runs all scenarios and prints pass rate, cost, duration, cycles used, and hard-constraint violations per scenario
  - Verify: `npm run eval` produces a table; the violations column is zero
  - Files: `evals/run.ts`, `package.json`

- [ ] **A6 — Per-participant justification quality**
  - Acceptance: every option names every confirmed participant. A run that silently omits someone fails validation rather than shipping — this is the failure mode a single agent holding six profiles is most prone to (plan, Principal Risks).
  - Verify: unit test where an agent response covering 5 of 6 participants is rejected
  - Files: `lib/matching/schemas.ts`, `lib/matching/validate.ts`, tests

### After Milestone 1

- [ ] **A7 — Constraint Updater: free-text rejection → structured constraint** — the project's central mechanism; give it the time freed by dropping the coordinator
- [ ] **A8 — Cycle loop with cap; new run from updated constraints**
- [ ] **A8b — Decide and implement: answer a rejection from the unused ranks 2–3, or always re-run?** (spec §13.7)
- [ ] **A9 — Prompt caching across cycles; measure the delta**
- [ ] **A10 — Model and effort sweep against the eval set** — specifically, can Haiku 4.5 hold six profiles at once without dropping one?
- [ ] **A11 — Optional, post-Milestone 2: build the superseded multi-agent variant and run both on the eval set** (spec §4.2). Turns the architecture decision into a measured result for the report. Cut this without hesitation if the schedule tightens.

---

## Track B — Data, Auth and Calendar

- [ ] **B1 — Postgres provisioned and connected**
  - Acceptance: the app connects to a real database in both development and on Vercel; F4 migrations applied
  - Verify: a health endpoint reports a successful query
  - Files: `lib/db/client.ts`, env config

- [ ] **B2 — Google sign-in**
  - Acceptance: a user signs in with Google and a `User` row is created. **Read-only calendar scope requested from the start.** App in Testing mode with team members added.
  - Verify: sign in on a phone; the row exists; the consent screen lists only the read-only scope
  - Files: auth route handlers, `lib/auth/*`

- [ ] **B3 — Preference profile persistence**
  - Acceptance: hard constraints and soft preferences save and load per user
  - Verify: save, reload the page, values persist
  - Files: `lib/db/profiles.ts`, API route

- [ ] **B4 — Groups and membership**
  - Acceptance: create a group, invite by email, accept an invite, list members
  - Verify: two accounts end up in one group
  - Files: `lib/db/groups.ts`, API routes

- [ ] **B5 — Meetings and responses**
  - Acceptance: initiate a meeting with any subset of date/time/venue — the all-blank case is the default path. Members respond with approve, `cant_make_it`, or `doesnt_suit` + reason. **The 3-open-meetings-per-group cap is enforced server-side**, not only by a disabled button.
  - Verify: a meeting with all three fields blank is valid and persists; a fourth open meeting is rejected by the API even when called directly
  - Files: `lib/db/meetings.ts`, API routes

- [ ] **B5b — Cross-group conflict query**
  - Acceptance: given a user, return every pair of their open meetings that collide in time, **across all their groups** (spec §5.7). Pure query plus a pure overlap function; no LLM.
  - Verify: unit test with a user in three groups and two colliding meetings in different groups — both are returned, and a same-group non-colliding pair is not. Runs on the F4 index
  - Files: `lib/meetings/conflicts.ts`, tests

- [ ] **B5c — Conflict cancellation as one transaction**
  - Acceptance: approving meeting A cancels colliding meeting B **in a single transaction across both**, and B **returns to weighing** with the approving user marked `cant_make_it` — B is never deleted (spec §5.7).
  - Verify: integration test — approve A, assert B is in `reweighing` with the user excluded and its other approvals preserved. Simulate a failure mid-write and assert neither meeting is left half-updated
  - Files: `lib/meetings/conflicts.ts`, `lib/db/meetings.ts`, tests

- [ ] **B6 — Google Calendar read and availability**
  - Acceptance: given confirmed participants and a date range, return free slots common to all
  - Verify: against two real team calendars with a known overlapping gap
  - Files: `lib/calendar/google.ts`, `lib/calendar/availability.ts`

- [ ] **B7 — Google Places integration with caching**
  - Acceptance: search restaurants by area and filters, returning coordinates for every result; identical queries hit a cache rather than the API
  - Verify: the same query twice produces one outbound API call; every result carries a lat/lng
  - Files: `lib/venues/places.ts`, `lib/venues/cache.ts`

- [ ] **B7b — Candidate search area: union of neighborhoods**
  - Acceptance: given N home neighborhoods, return the search area as the union of each participant's neighborhood plus a radius around it (spec §5.4). Not a centroid. The radius is a tunable constant — §13.5.
  - Verify: run it on the three of you; the area contains restaurants you would actually consider, and does not contain a park or the sea
  - Files: `lib/venues/search-area.ts`, tests

- [ ] **B7c — Candidate funnel: filter and pre-rank**
  - Acceptance: all venues in the area → drop hard-constraint violations (A2) → pre-rank by distance fairness (A3) and rating → return the top N (start at 15), **each carrying its per-participant distances** so the agent does not have to compute them. Deterministic code, no LLM.
  - Verify: unit test — a venue violating a hard constraint never reaches the shortlist, however good its rating; the shortlist is ≤ N and every entry has one distance per participant
  - Files: `lib/venues/funnel.ts`, tests

### After Milestone 1

- [ ] **B8 — Transactional email: invitations and notifications**
- [ ] **B9 — Retry and error handling on external calls**
- [ ] **B10 — Token refresh for expired Google credentials**

---

## Track C — UI and Product Flow

- [ ] **C1 — Mobile-first shell and navigation**
  - Acceptance: layout, navigation, and typography designed for a phone. Not a desktop layout that shrinks.
  - Verify: open on a real phone; nothing overflows, nothing needs zoom
  - Files: `app/layout.tsx`, `app/globals.css`, shell components

- [ ] **C2 — Preference game**
  - Acceptance: this-or-that questions producing an initial soft-preference set in under a minute
  - Verify: time a person who has not seen it before; under 60 seconds
  - Files: `app/onboarding/*`, components

- [ ] **C3 — Hard constraints screen**
  - Acceptance: kosher, allergies, and fixed unavailable hours — explicit, not inferred
  - Verify: set a constraint, reload, it persists
  - Files: `app/profile/*`

- [ ] **C3b — Home location and travel tolerance**
  - Acceptance: user sets a home location at **neighborhood granularity, not a street address** (spec §5.4), plus how far they are willing to travel. The privacy framing should be visible in the UI — people are giving this to a group of friends, and they should see that it is coarse.
  - Verify: set a location, reload, it persists; the stored value is not a precise address
  - Files: `app/profile/location/*`

- [ ] **C4 — Group creation and invite**
  - Acceptance: create a group, invite by email, see pending and accepted members
  - Verify: a second account joins via the invite
  - Files: `app/groups/*`

- [ ] **C5 — Group feed**
  - Acceptance: meetings as cards **sorted by date, nearest first**, past ones below a divider. Each row carries the date block, status label, mini avatars in their current states, and a one-line summary of where it stands. A row awaiting the viewer is marked so it is findable while scanning even mid-list (spec §5.6). Initiate button at the bottom, disabled at the 3-meeting cap with an explanation.
  - Verify: with 3 open meetings, someone who has not seen the app names which one needs them **without opening anything**. The disabled button explains why
  - Files: `app/groups/[id]/page.tsx`, feed components

- [ ] **C5b — Initiate a meeting**
  - Acceptance: one button starts it. Optional date/time/venue exist but the all-blank case is the default path, not a degraded one.
  - Verify: press it with nothing filled in; a meeting is created and weighing starts
  - Files: `app/groups/[id]/new/*`

- [ ] **C6 — Meeting screen: the three blocks**
  - Acceptance: (1) the proposal with an expandable **"why this suits you"** written for the viewer, including the line naming what it costs them; (2) **"where it stands"** — progress bar, one-line summary, every participant with state and timestamp, including those who dropped out; (3) **"what happened so far"** as a timeline of proposals, rejections, and reasons (spec §5.6).
  - Verify: two accounts open the same meeting and see two different personal justifications. The dropped-out participant is still listed
  - Note: this replaces the separate reasoning viewer. It is product, not debug — it is the only place the user sees that their constraints were weighed.
  - Files: `app/meetings/[id]/*`

- [ ] **C7 — The two rejection buttons**
  - Acceptance: approve, "I can't make it", and "something here doesn't work for me" as three distinct controls. The second opens a free-text field and shows the remaining cycle count (spec §3.2).
  - Verify: each button writes a different value; "I can't make it" does **not** decrement the cycle counter and "something doesn't work" does
  - Files: `app/meetings/[id]/respond/*`

- [ ] **C8 — All-groups screen and conflict warnings**
  - Acceptance: every group with a count of what awaits the user, plus a single timeline of all their open meetings across groups. Conflicts surface in **three** places: a feed banner, a `conflicting` label on the row, and a warning strip **directly above the approve button** (spec §5.7).
  - Verify: a user with colliding meetings in two groups cannot reach the approve button without passing the warning. Approving shows what will happen to the other meeting **before** the press, not after
  - Files: `app/page.tsx`, `app/groups/page.tsx`, conflict components

- [ ] **C8b — The `stuck` state has a screen**
  - Acceptance: a meeting that exhausts all three weighings shows the best option found, an explanation of why it stopped, and a way for the group to settle it themselves. It does not silently vanish from the feed.
  - Verify: force a meeting to 3 cycles; it appears in the feed as `stuck` and the screen explains what to do
  - Files: `app/meetings/[id]/*`

### After Milestone 1

- [ ] **C9 — In-app notification center**
- [ ] **C10 — Empty, loading, and error states across every screen**
- [ ] **C11 — Full pass on a real phone with a stranger, no help given**

---

## Milestone 1 — Week 4–5

**Gate:** the full flow runs end to end on the live URL with fabricated venues and simplified profiles.

- [ ] Create a group with 3 real accounts
- [ ] Initiate a get-together with no date, time, or venue
- [ ] The matching run completes inside the measured timeout budget
- [ ] A proposal card appears in the feed for all three, **each seeing why it works for them**
- [ ] The meeting screen shows all three blocks, including who has responded and what happened so far
- [ ] Both rejection buttons work, and only one of them spends a cycle
- [ ] Two meetings run in the same group at once, sorted by date
- [ ] The eval set runs and reports a pass rate with zero hard-constraint violations

Nothing moves to post-milestone work until every box above is checked.

## Milestone 2 — Week 9

**Gate:** the same flow with real restaurants, real calendars, and a working rejection loop. A rejection in free text produces a materially different next proposal that visibly addresses the stated reason.

Plus, added by the interface decisions: a user in **two** groups with colliding meetings is warned before approving either, and approving one returns the other to weighing rather than deleting it.

---

## Immediate next step

Assign a track per person, then all three do Week 1 together. **F2 first** — it still blocks A4, though it is now a measurement rather than an infrastructure decision. **F1b (the Easy email) on day one** — the reply arrives on their schedule, so the sooner it goes out the more likely it lands in time to matter.

Within Track A, **A2 before A4**: the hard-constraint filter is the guardrail the single-agent design depends on, and building the agent first invites trusting it with things it should never have been trusted with.

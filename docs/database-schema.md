# Database Schema — SquadLock

Reference for [`prisma/schema.prisma`](../prisma/schema.prisma). Built for
[spec §6.2](spec.md#62-data-model) as part of **F4** (Week 1 foundation,
[tasks/todo.md](../tasks/todo.md)). If this document and the schema ever
disagree, the schema is the source of truth — update this file to match it,
not the other way around.

The schema has **16 tables**: 9 that carry product data, 2 join tables
(`GroupMember`, `MatchRunSeenContext`) that resolve many-to-many
relationships, 2 Places caches, an invitation table, a notification log and
the in-app notifications.
All primary keys are `String @default(cuid())` unless noted.

---

## Identity

### `users`

One person. Identity and Google tokens only — every preference lives in
`preference_profiles` instead, so this table stays small and rarely written.

| Column                  | Type       | Notes                                           |
| ----------------------- | ---------- | ----------------------------------------------- |
| `id`                    | `String`   | PK                                              |
| `email`                 | `String`   | unique                                          |
| `name`                  | `String`   |                                                 |
| `googleId`              | `String`   | unique — the Google OAuth `sub`                 |
| `googleRefreshToken`    | `String?`  | for `calendar.freebusy` reads (spec §5.2, §6.3) |
| `createdAt`/`updatedAt` | `DateTime` |                                                 |

**Relations:** one `PreferenceProfile`; many `GroupMember`, `Meeting`
(as initiator), `Response`, `ParticipantMeetingContext`,
`ConflictDismissal`, `Invitation` (as sender and as acceptor),
`Notification`.

### `preference_profiles`

Hard constraints, soft preferences, home location and travel tolerance
(spec §5.1). One row per user, created once the onboarding flow finishes.

| Column                   | Type       | Notes                                                                                                                                                                                                                                                              |
| ------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                     | `String`   | PK                                                                                                                                                                                                                                                                 |
| `userId`                 | `String`   | FK → `users.id`, unique (1:1)                                                                                                                                                                                                                                      |
| `hardConstraints`        | `Json`     | kosher, allergies, fixed unavailable hours — enforced in code (spec §4.1b), never left to the model                                                                                                                                                                |
| `softPreferences`        | `Json`     | `budget` (`modest` / `splurge`), `venueKinds` (`bar` / `cafe` / `restaurant`), `cuisines` (10 values) — output of the preference game; vocabulary in `lib/preferences/vocabulary.ts`. Keys from the old vocabulary are ignored on read (`softPreferencesFromJson`) |
| `homeLat`, `homeLng`     | `Float?`   | **neighbourhood granularity**, never a street address (spec §5.4)                                                                                                                                                                                                  |
| `homeNeighbourhood`      | `String?`  | display label                                                                                                                                                                                                                                                      |
| `toleranceKm`            | `Float`    | default `5` — burden denominator (spec §5.4)                                                                                                                                                                                                                       |
| `recurringMobilityRules` | `Json`     | e.g. "no car on Fridays" — distinct from fixed unavailable hours: affects distance, not availability (spec §5.1)                                                                                                                                                   |
| `createdAt`/`updatedAt`  | `DateTime` |                                                                                                                                                                                                                                                                    |

**Why JSON for constraints/preferences:** the exact shape is still moving
under Track A/C (the soft-preference vocabulary has already been replaced
once, #217). Narrowing a JSON column to real columns later is a cheap,
additive migration; guessing the shape wrong now and re-migrating a
populated table is not.

**Indexes:** unique on `userId`.

---

## Groups

### `groups`

A group of 3–6 friends (spec §1.2, §5.3). Deliberately minimal — no owner
role, no settings; decision 2 in [intent](intent/squadlock.md) rules out
anything that needs a human-run admin flow.

| Column                  | Type       | Notes |
| ----------------------- | ---------- | ----- |
| `id`                    | `String`   | PK    |
| `name`                  | `String`   |       |
| `createdAt`/`updatedAt` | `DateTime` |       |

**Relations:** many `GroupMember`, `Meeting`, `Invitation`.

### `group_members` _(join table)_

Resolves the many-to-many between `User` and `Group` — a user belongs to
several groups at once, and a group has several members.

| Column               | Type       | Notes                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                 | `String`   | PK                                                                                                                                                                                                                                                                                                                                                                                              |
| `groupId`            | `String`   | FK → `groups.id`, cascade delete                                                                                                                                                                                                                                                                                                                                                                |
| `userId`             | `String`   | FK → `users.id`, cascade delete                                                                                                                                                                                                                                                                                                                                                                 |
| `joinedAt`           | `DateTime` |                                                                                                                                                                                                                                                                                                                                                                                                 |
| `failedVenueLookups` | `Int`      | default `0` — venues this member typed for a new meeting that Google did not find, or found as something other than a restaurant, bar or café (#240). At 3 the venue field locks and no more Places lookups are made; reset to `0` when they open a meeting in this group (`lib/meetings/venue-check.ts`, `initiateMeeting`). Here rather than in the form, so a reload cannot buy more lookups |

**Indexes:** unique on `(groupId, userId)`; index on `userId` (list a
user's groups).

### `invitations`

An invitation to join a group, by email (spec §5.3, §12.1) — the only way
anyone joins a group. Keyed on `email`, not `userId`, because the invitee
has no `User` row yet when it is sent. Accepting it (after signing in) is
what creates their `group_members` row.

| Column                  | Type               | Notes                                                 |
| ----------------------- | ------------------ | ----------------------------------------------------- |
| `id`                    | `String`           | PK                                                    |
| `groupId`               | `String`           | FK → `groups.id`, cascade delete                      |
| `email`                 | `String`           |                                                       |
| `invitedById`           | `String`           | FK → `users.id`                                       |
| `status`                | `InvitationStatus` | `pending` / `accepted`; default `pending`             |
| `token`                 | `String`           | unique, a v4 UUID — what the emailed link carries     |
| `acceptedByUserId`      | `String?`          | FK → `users.id`; set only once `status` is `accepted` |
| `respondedAt`           | `DateTime?`        |                                                       |
| `createdAt`/`updatedAt` | `DateTime`         |                                                       |

**Indexes:** unique on `(groupId, email)` — inviting the same address twice
re-sends, it does not duplicate; index on `email`.

---

## Meetings

### `meetings`

One get-together from initiation to close (spec §6.2). `conflicting` is
deliberately **not** a stored status — spec §5.6 derives it at read time
from the cross-group query plus `ConflictDismissal`.

| Column                  | Type            | Notes                                                                                                                                                                                                                                                                               |
| ----------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                    | `String`        | PK                                                                                                                                                                                                                                                                                  |
| `groupId`               | `String`        | FK → `groups.id`, cascade delete                                                                                                                                                                                                                                                    |
| `initiatorId`           | `String`        | FK → `users.id`                                                                                                                                                                                                                                                                     |
| `status`                | `MeetingStatus` | enum: `weighing` / `awaiting` / `closed` / `stuck` / `cancelled`; default `weighing`                                                                                                                                                                                                |
| `cycleCount`            | `Int`           | default `0` — the reject-and-rematch counter (spec §3.1, cap 3); a conflict reschedule (#251) is not counted                                                                                                                                                                        |
| `pinnedDate`            | `Date?`         | optionally set at initiation                                                                                                                                                                                                                                                        |
| `pinnedTime`            | `String?`       | optionally set at initiation                                                                                                                                                                                                                                                        |
| `pinnedVenue`           | `String?`       | optionally set at initiation                                                                                                                                                                                                                                                        |
| `occasion`              | `String?`       | free text, an input to the Context Resolver (spec §6.2)                                                                                                                                                                                                                             |
| `currentDatetime`       | `DateTime?`     | **denormalized** — see below                                                                                                                                                                                                                                                        |
| `runStage`              | `RunStage?`     | where the run is now (#155) — see below                                                                                                                                                                                                                                             |
| `retryNotBefore`        | `DateTime?`     | B9 — no automatic retry before this instant; set after a rate-limited model call, cleared by any call that gets past it. `NULL` is "nothing special"                                                                                                                                |
| `stuckReason`           | `StuckReason?`  | Why the meeting is `stuck` (#246, #247): `cycle_cap` (three proposals turned down), `no_time` (no time everyone shares) or `no_venue` (no venue that fits). `NULL` is "not recorded" — stuck before the column existed, or another cause. Only meaningful while `status` is `stuck` |
| `createdAt`/`updatedAt` | `DateTime`      |                                                                                                                                                                                                                                                                                     |

**`currentDatetime` is not in spec §6.2 verbatim.** It mirrors the datetime
of the current rank-1 `MatchOption` (or the pinned datetime, if given), kept
in sync by the application whenever a new top option is chosen. Without it,
sorting the feed by date or scanning "open meetings at time T" would need a
join through `MatchRun` → `MatchOption` on every read; with it, both are a
direct read off `meetings`.

**`runStage` is progress, not state (#155).** `runCycle` writes each stage
as it enters it — `calendars`, `places`, `venue_details`, `model`, `saving` —
and clears it when the run ends, however it ends, so the screens that already
poll can show where a run is. A run killed mid-stage leaves its stage on the
row until the retry overwrites it, so readers go through `runStageOf`, which
returns it only while `status` is `weighing`.

**Relations:** many `MatchRun`, `Response`, `ParticipantMeetingContext`,
`NotificationLog`, `Notification`; two
named relations into `ConflictDismissal` (`MeetingA` / `MeetingB` — see
below).

**Indexes:** `groupId`; composite `(status, currentDatetime)` for the feed
sort and the conflict scan.

### `match_runs`

One weighing cycle of a meeting (spec §4.1d — every run persisted in full).

| Column        | Type       | Notes                                                                                               |
| ------------- | ---------- | --------------------------------------------------------------------------------------------------- |
| `id`          | `String`   | PK                                                                                                  |
| `meetingId`   | `String`   | FK → `meetings.id`, cascade delete                                                                  |
| `cycleNumber` | `Int`      | 1, 2, 3, ...                                                                                        |
| `shortlist`   | `Json`     | the candidate venues that went in, with per-participant distances and viable time slots (spec §5.4) |
| `createdAt`   | `DateTime` |                                                                                                     |

**What the run cost (A4)** — stored, not logged, because A5 and the report
total it later. All nullable together: a run that failed before the model
call has none of them.

| Column                                                         | Type             | Notes                                                                           |
| -------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------- |
| `model`, `thinkingLevel`                                       | `String?`        | what was called                                                                 |
| `durationMs`                                                   | `Int?`           |                                                                                 |
| `inputTokens`, `outputTokens`, `thoughtTokens`, `cachedTokens` | `Int?`           |                                                                                 |
| `costUsd`                                                      | `Decimal(12,8)?` | `NULL`, never `0`, for a model missing from the price table (`lib/llm/cost.ts`) |
| `costBasis`                                                    | `String?`        | `exact` / `approximate` / `unknown` — how far to trust `costUsd`                |

**A run with `model` `NULL` and `cycleNumber` > 1 is a conflict reschedule**
(#251), written by `lib/matching/reschedule.ts`: same venue, new time, no
model call. It is not a rematch, so `weigh` (`lib/matching/run-cycle.ts`) subtracts such runs when it
sets `meetings.cycleCount` from `cycleNumber`.

**Relations:** many `MatchOption`; many `MatchRunSeenContext` (which
`ParticipantMeetingContext` rows this run saw).

**Indexes:** unique on `(meetingId, cycleNumber)`; index on `meetingId`.

### `match_options`

One of the ranked options a run produced (spec §4.1c). Only rank 1 is ever
shown to the user; ranks 2–3 are kept for the timeline, the eval set, and
the report.

| Column                      | Type               | Notes                                                                                                                                                                                                                                                |
| --------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                        | `String`           | PK                                                                                                                                                                                                                                                   |
| `matchRunId`                | `String`           | FK → `match_runs.id`, cascade delete                                                                                                                                                                                                                 |
| `rank`                      | `Int`              | 1–3                                                                                                                                                                                                                                                  |
| `venuePlaceId`              | `String?`          | Google Places id, if resolved from a real venue                                                                                                                                                                                                      |
| `venueName`, `venueAddress` | `String`/`String?` | snapshot at decision time — Places data can change later                                                                                                                                                                                             |
| `venueLat`, `venueLng`      | `Float?`           |                                                                                                                                                                                                                                                      |
| `venueType`, `venueSummary` | `String?`          | What the place is ("מסעדה איטלקית") and Google's one-line description, as Places gave them (#163). Shown under the venue name on the proposal                                                                                                        |
| `venuePrice`                | `Json?`            | What a diner is expected to pay (#249): `{ level?, min?, max?, currency? }` as Google reported it. `NULL` when Google gave neither a range nor a level, and for options created before the column. Shown under the venue description on the proposal |
| `venueTypes`                | `String[]`         | The venue's Google Places `types` at decision time (#248). The "this place" chip in the rejection form derives its cuisines from them on read. Empty for options created before the column                                                           |
| `proposedDatetime`          | `DateTime`         |                                                                                                                                                                                                                                                      |
| `proposedEnd`               | `DateTime`         | stored, not implied: B6 shortens a meeting to fit a venue's opening hours                                                                                                                                                                            |
| `participantJustifications` | `Json`             | `userId → text`, written for that viewer specifically (spec §5.6)                                                                                                                                                                                    |
| `tradeoffs`                 | `Json`             | what this option costs, and for whom — persisted for the timeline/report but **never** rendered as a comparative cost line to the person who bore it (spec §5.6)                                                                                     |
| `unverified`                | `Json`             | `UnverifiedFact[]`, default `[]` — what A2 could not check (e.g. opening hours). Shown to everybody, written by code, never by the model                                                                                                             |
| `createdAt`                 | `DateTime`         |                                                                                                                                                                                                                                                      |

**Indexes:** unique on `(matchRunId, rank)`.

### `responses`

Per-user, per-meeting response (spec §3.2). **A row exists for every group
member from the moment the meeting is created**, defaulting to `pending` —
not created lazily when someone responds. This is what keeps a dropped-out
member listed instead of disappearing (spec §5.6), and it is the join that
makes "every open meeting for user X" an **indexed lookup** rather than a
scan (spec §5.7): index on `userId`, joined to `meetings` by primary key.
Verified with `EXPLAIN ANALYZE` at realistic data volume — see
[`prisma/verify-conflict-index.sql`](../prisma/verify-conflict-index.sql).

| Column                  | Type                 | Notes                                                                            |
| ----------------------- | -------------------- | -------------------------------------------------------------------------------- |
| `id`                    | `String`             | PK                                                                               |
| `meetingId`             | `String`             | FK → `meetings.id`, cascade delete                                               |
| `userId`                | `String`             | FK → `users.id`, cascade delete                                                  |
| `status`                | `ResponseStatus`     | enum: `pending` / `approved` / `cant_make_it` / `doesnt_suit`; default `pending` |
| `reasonText`            | `String?`            | free text for `doesnt_suit`. **The latest one only** — see below                 |
| `respondedAt`           | `DateTime?`          | likewise the latest                                                              |
| `extractionOutcome`     | `ExtractionOutcome?` | what A7 made of the latest `reasonText`, or why it made nothing of it            |
| `createdAt`/`updatedAt` | `DateTime`           |                                                                                  |

**Indexes:** unique on `(meetingId, userId)`; index on `userId` (the
conflict-query join key).

> ### ⚠️ This row is a _state_, not a _history_ — and the difference bit us
>
> There is exactly one row per `(meeting, user)` and `respondToMeeting`
> **updates** it. So `status`, `reasonText`, `respondedAt` and
> `extractionOutcome` always describe that person's **latest** response, and
> every earlier one is gone. Dana rejecting three times leaves one row
> carrying her third sentence and the time she wrote it.
>
> That is the right shape for the question this table answers — _"where does
> each person stand right now?"_ — and the wrong shape for two things that
> were built on top of it anyway:
>
> - **The next proposal.** "No Asian food" has no `SoftPreferences` field to
>   land in, so the sentence was its only record — and it was destroyed the
>   moment the same person wrote "no Italian either". The matching agent could
>   then walk straight back into the objection it had already been given.
> - **The timeline.** C6's _"what happened so far"_ and C8b's `stuck` screen
>   built one event per **person** from this row. Because `respondedAt` is also
>   the latest, Dana's single event was stamped 21:50 while the re-weighing it
>   caused sat at 20:32 — **the cause rendered after its effect**, on the two
>   screens whose entire job is to explain what happened.
>
> **What to do instead.** Every rejection now appends a row to
> `participant_meeting_contexts` (`rejectionText`, `rejectionOutcome`), where
> each one keeps its own words, its own outcome and its own `createdAt`. Read
> the history from there; read "where they stand" from here.
>
> **The rule worth carrying to the next column.** Before adding a column to a
> row that is updated, ask whether anything will ever need the value it
> replaces. If the answer is yes — a timeline, an audit, an agent's memory —
> it belongs on an append-only table instead, however convenient the updated
> row looks. And a reader that draws a _sequence_ from an _updated_ row does
> not merely lose detail: it puts events in the wrong order, which is worse,
> because it still looks correct.
>
> Found while wiring A8 ([tasks/a8-plan.md](../tasks/a8-plan.md), step 3).

### `participant_meeting_contexts`

Sparse per-meeting correction — "no car tonight", "coming from work" (spec
§3.2, §5.7). A row is written when someone amends and for every rejection
(A8) — a rejection with ticked reasons and its own words writes one row for
each (#244). **Each one appends a new row** rather than overwriting the last
one, so the timeline can show which amendment or rejection triggered which
re-weighing (spec §5.6).

| Column                                  | Type                        | Notes                                                                                                                                                                                                                |
| --------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                    | `String`                    | PK                                                                                                                                                                                                                   |
| `meetingId`                             | `String`                    | FK → `meetings.id`, cascade delete                                                                                                                                                                                   |
| `userId`                                | `String`                    | FK → `users.id`, cascade delete                                                                                                                                                                                      |
| `originLat`, `originLng`, `originLabel` | `Float?`/`Float?`/`String?` | origin override for this one meeting                                                                                                                                                                                 |
| `mobilityWindows`                       | `Json`                      | mode-tagged windows — `car` / `transit` / `walk` (spec §6.2)                                                                                                                                                         |
| `softPreferences`                       | `Json?`                     | A7's correction, a `TonightCorrection`: soft preferences plus `avoidVenueKinds` / `avoidCuisines` (#220). `NULL` is "no correction"; `{}` would read as "corrected to nothing"                                       |
| `rejectionText`                         | `String?`                   | the objection in the person's own words (A8)                                                                                                                                                                         |
| `rejectionOutcome`                      | `ExtractionOutcome?`        | what A7 made of **this** objection, kept per row because A8 blocks the whole venue for `soft`/`venue_identity`/`distance`/`none` and only the exact (venue, hour) pair for `time`/`failed_*` (`blockedByRejections`) |
| `toleranceKm`                           | `Float?`                    | travel tolerance for this meeting only (#222); replaces the profile's in the weighing. `NULL` is "the profile's"                                                                                                     |
| `earliestStart`                         | `String?`                   | local `HH:MM` (#223); everything before it is treated as busy. `NULL` is "no bound"                                                                                                                                  |
| `latestStart`                           | `String?`                   | local `HH:MM` (#223); a start after it is an A2 violation. `NULL` is "no bound"                                                                                                                                      |
| `untranslated`                          | `String?`                   | what a rejection asked for that no lever can act on, in A7's words — kept so the missing levers can be counted (#220)                                                                                                |
| `note`                                  | `String?`                   | free text                                                                                                                                                                                                            |
| `createdAt`                             | `DateTime`                  |                                                                                                                                                                                                                      |

**Three kinds of row, told apart by which columns are set** — and the one
free amendment per participant (spec §3.1) is counted as rows with _neither_
a correction nor a rejection, so adding a third kind here means revisiting
that count in `respondToMeeting`:

| Row                                                                                 | `softPreferences` | `rejectionText` |
| ----------------------------------------------------------------------------------- | ----------------- | --------------- |
| an amendment                                                                        | `NULL`            | `NULL`          |
| a rejection that became a correction (`soft`), from A7 or ticked reasons            | set               | set             |
| a rejection that did not (`time`, `distance`, `venue_identity`, `none`, `failed_*`) | `NULL`            | set             |

Any of the three may also carry `toleranceKm`, `earliestStart` or
`latestStart`; only a rejection carries `untranslated`.

**Relations:** many `MatchRunSeenContext` (which runs saw this row) — which is
also how A8 tells an answered rejection from one written while a run was in
flight, since a `MatchRun` is stamped when it is _written_ and no timestamp
comparison can separate the two.

**Indexes:** composite `(meetingId, userId, createdAt)`.

### `match_run_seen_contexts` _(join table)_

Records which `ParticipantMeetingContext` rows a given `MatchRun` saw (spec
§6.2: "Each MatchRun records which rows it saw") — how the timeline
explains _why_ a re-weighing happened.

| Column       | Type     | Notes                                                  |
| ------------ | -------- | ------------------------------------------------------ |
| `matchRunId` | `String` | FK → `match_runs.id`, cascade delete                   |
| `contextId`  | `String` | FK → `participant_meeting_contexts.id`, cascade delete |

**Primary key:** composite `(matchRunId, contextId)` — no separate `id`.

### `conflict_dismissals`

Per user and unordered meeting pair: this user has said the two do not
clash (spec §5.7). Without it, the conflict warning returns on every poll
and every reload.

| Column       | Type       | Notes                              |
| ------------ | ---------- | ---------------------------------- |
| `id`         | `String`   | PK                                 |
| `userId`     | `String`   | FK → `users.id`, cascade delete    |
| `meetingAId` | `String`   | FK → `meetings.id`, cascade delete |
| `meetingBId` | `String`   | FK → `meetings.id`, cascade delete |
| `createdAt`  | `DateTime` |                                    |

**"Unordered pair" is enforced by the application, not the database.**
Postgres unique constraints are ordered, so before every insert or lookup
the application must sort the pair into a canonical order (e.g.
`meetingAId < meetingBId` as strings) — otherwise `(X, Y)` and `(Y, X)`
would be treated as two different dismissals. The helper is
`canonicalMeetingPair` in `lib/db/conflict-dismissal.ts`.

**Indexes:** unique on `(userId, meetingAId, meetingBId)`.

---

## Places cache (B7)

Two tiers, cached separately (spec §6.3). Neither is tied to a meeting —
a place is a property of a location, shared by every meeting nearby. The
freshness and rounding rules live in `lib/db/places-cache.ts`, and every
caller goes through it, never the raw client in `lib/places/client.ts`.

### `place_search_cache`

Tier 1: the broad Nearby Search result (restaurants, bars and cafés, #165) for one neighbourhood-sized area.
Kept 30 days.

| Column          | Type       | Notes                                                                                                                                                                                                                           |
| --------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | `String`   | PK                                                                                                                                                                                                                              |
| `latKey`        | `Float`    | rounded by `roundToNeighbourhood`, so nearby searches hit the same row                                                                                                                                                          |
| `lngKey`        | `Float`    | likewise                                                                                                                                                                                                                        |
| `radiusMeters`  | `Int`      |                                                                                                                                                                                                                                 |
| `includedTypes` | `String`   | the Nearby Search `includedTypes`, sorted and comma-joined (e.g. `bar,cafe,restaurant`) — keyed so a morning search (cafés only) never gets an evening's answer (#168)                                                          |
| `results`       | `Json`     | `Candidate[]` — Essentials and Pro fields only; `rating`/hours are tier 2. Each candidate carries Google's `types` (#219) and `primaryType` (#240); a row whose candidates lack either is treated as a miss (`getCachedSearch`) |
| `fetchedAt`     | `DateTime` |                                                                                                                                                                                                                                 |

**Indexes:** unique on `(latKey, lngKey, radiusMeters, includedTypes)`.

### `place_details_cache`

Tier 2: the Enterprise-tier fields for one shortlisted place. Kept 24 hours
— shorter on purpose, because opening hours are what decide whether a
proposal is real.

| Column                 | Type       | Notes                                                                                                                                                                                          |
| ---------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `placeId`              | `String`   | PK — the Google Places id, exact and stable, so no rounding                                                                                                                                    |
| `rating`               | `Float?`   |                                                                                                                                                                                                |
| `openingHours`         | `Json`     | `LocalWindow[]`, default `[]`. `[]` is "fetched, no hours"; a missing row is "never fetched"                                                                                                   |
| `budget`               | `String?`  | `modest` / `splurge`, from Places `priceLevel` (#139). `NULL` is "not known", including `MODERATE`                                                                                             |
| `summary`              | `String?`  | Places `editorialSummary`, in Hebrew where Google has it (#163). `NULL` when Google has none                                                                                                   |
| `servesVegetarianFood` | `Boolean?` | Places `servesVegetarianFood`. `NULL` is "not known" — Google did not say, or the row predates the column                                                                                      |
| `price`                | `Json?`    | Places `priceRange` and `priceLevel` as `{ level?, min?, max?, currency? }` (#249). `NULL` is "not known" — Google gave neither, or the row predates the column (refetched within the 24h TTL) |
| `fetchedAt`            | `DateTime` |                                                                                                                                                                                                |

---

## Notifications (B8)

### `notification_log`

One row per transactional-email attempt (spec §5.5). A failed send is a row
here, never a reason a meeting or invitation write rolled back — every
`notify*` call in `lib/email/notify.ts` runs after the change it reports has
committed. Append-only: a retry (B9, `retryDueNotifications` in
`lib/email/retry.ts`) writes a new row rather than updating the failed one.

| Column              | Type                 | Notes                                                                                                                    |
| ------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `id`                | `String`             | PK                                                                                                                       |
| `kind`              | `NotificationKind`   | which of the five spec §5.5 triggers, or `calendar_reconnect`                                                            |
| `recipientEmail`    | `String`             | the address actually used — a snapshot, not a `User` relation                                                            |
| `status`            | `NotificationStatus` | `sent` / `failed`                                                                                                        |
| `providerMessageId` | `String?`            | Resend's id for the message, to look it up in their dashboard                                                            |
| `errorMessage`      | `String?`            |                                                                                                                          |
| `meetingId`         | `String?`            | FK → `meetings.id`, cascade delete                                                                                       |
| `invitationId`      | `String?`            | FK → `invitations.id`, cascade delete                                                                                    |
| `attempt`           | `Int`                | default `1` — B9; a retry writes a new row one higher, never updates this one                                            |
| `retriedAt`         | `DateTime?`          | B9 — set once a failed row is claimed for a retry; the lock against two polls retrying it. Always `NULL` on a `sent` row |
| `createdAt`         | `DateTime`           |                                                                                                                          |

A row is about **at most one** of a meeting or an invitation — never both.
Only `calendar_reconnect` is about neither: a broken calendar connection is
the user's, not one meeting's. The database does not enforce this; the
senders do.

**Indexes:** `meetingId`; `invitationId`; composite `(status, retriedAt)`.

### `notifications`

The in-app half of spec §5.5 (C9): one row per recipient per trigger, written
beside the `notification_log` row for the same event, never instead of it.
A separate table because the log is keyed on an email address and has no
read state. `invitation` is never written here — there is nobody signed in
to show it to.

| Column      | Type               | Notes                                                               |
| ----------- | ------------------ | ------------------------------------------------------------------- |
| `id`        | `String`           | PK                                                                  |
| `userId`    | `String`           | FK → `users.id`, cascade delete                                     |
| `kind`      | `NotificationKind` |                                                                     |
| `meetingId` | `String?`          | FK → `meetings.id`, cascade delete; `NULL` for `calendar_reconnect` |
| `readAt`    | `DateTime?`        | `NULL` is unread                                                    |
| `createdAt` | `DateTime`         |                                                                     |

**Indexes:** composite `(userId, readAt)` — this user's, unread first.

---

## Enums

| Enum                 | Values                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `MeetingStatus`      | `weighing` · `awaiting` · `closed` · `stuck` · `cancelled`                                                                                 |
| `ResponseStatus`     | `pending` · `approved` · `cant_make_it` · `doesnt_suit`                                                                                    |
| `RunStage`           | `calendars` · `places` · `venue_details` · `model` · `saving`                                                                              |
| `InvitationStatus`   | `pending` · `accepted`                                                                                                                     |
| `ExtractionOutcome`  | `soft` · `distance` · `time` · `venue_identity` · `none` — or why nothing was extracted: `failed_quota` · `failed_call` · `failed_invalid` |
| `NotificationKind`   | `invitation` · `proposal_waiting` · `meeting_confirmed` · `conflict_reweigh` · `stuck` · `calendar_reconnect`                              |
| `NotificationStatus` | `sent` · `failed`                                                                                                                          |

---

## Environments and migrations

| Where             | Database                                      | Who applies migrations                         |
| ----------------- | --------------------------------------------- | ---------------------------------------------- |
| Your machine      | a local Postgres (see [README](../README.md)) | you, with `npm run db:migrate:dev`             |
| Vercel Preview    | production's, until #157 adds a staging one   | nobody — Previews must not migrate a shared DB |
| Vercel Production | Supabase                                      | the deploy itself (`vercel-build`, #153)       |

Never point a local `.env.local` at the production database. Until
2026-09-30 every local `.env.local` did, which is how migrations reached
production at all — by accident, and up to 16 days late. The rules for
writing a migration are in [AGENTS.md](../AGENTS.md) → Migrations.

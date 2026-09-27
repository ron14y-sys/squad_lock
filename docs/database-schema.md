# Database Schema — SquadLock

Reference for [`prisma/schema.prisma`](../prisma/schema.prisma). Built for
[spec §6.2](spec.md#62-data-model) as part of **F4** (Week 1 foundation,
[tasks/todo.md](../tasks/todo.md)). If this document and the schema ever
disagree, the schema is the source of truth — update this file to match it,
not the other way around.

The schema has **11 tables**: 9 that carry product data, plus 2 pure join
tables (`GroupMember`, `MatchRunSeenContext`) that resolve many-to-many
relationships. All primary keys are `String @default(cuid())` unless noted.

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
`ConflictDismissal`.

### `preference_profiles`

Hard constraints, soft preferences, home location and travel tolerance
(spec §5.1). One row per user, created once the onboarding flow finishes.

| Column                   | Type       | Notes                                                                                                            |
| ------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------- |
| `id`                     | `String`   | PK                                                                                                               |
| `userId`                 | `String`   | FK → `users.id`, unique (1:1)                                                                                    |
| `hardConstraints`        | `Json`     | kosher, allergies, fixed unavailable hours — enforced in code (spec §4.1b), never left to the model              |
| `softPreferences`        | `Json`     | cuisine, budget, atmosphere, noise — output of the this-or-that game                                             |
| `homeLat`, `homeLng`     | `Float?`   | **neighbourhood granularity**, never a street address (spec §5.4)                                                |
| `homeNeighbourhood`      | `String?`  | display label                                                                                                    |
| `toleranceKm`            | `Float`    | default `5` — burden denominator (spec §5.4)                                                                     |
| `recurringMobilityRules` | `Json`     | e.g. "no car on Fridays" — distinct from fixed unavailable hours: affects distance, not availability (spec §5.1) |
| `createdAt`/`updatedAt`  | `DateTime` |                                                                                                                  |

**Why JSON for constraints/preferences:** the exact shape is still moving
under Track A/C (the preference game and hard-constraints screen aren't
built yet). Narrowing a JSON column to real columns later is a cheap,
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

**Relations:** many `GroupMember`, `Meeting`.

### `group_members` _(join table)_

Resolves the many-to-many between `User` and `Group` — a user belongs to
several groups at once, and a group has several members.

| Column     | Type       | Notes                            |
| ---------- | ---------- | -------------------------------- |
| `id`       | `String`   | PK                               |
| `groupId`  | `String`   | FK → `groups.id`, cascade delete |
| `userId`   | `String`   | FK → `users.id`, cascade delete  |
| `joinedAt` | `DateTime` |                                  |

**Indexes:** unique on `(groupId, userId)`; index on `userId` (list a
user's groups).

---

## Meetings

### `meetings`

One get-together from initiation to close (spec §6.2). `conflicting` is
deliberately **not** a stored status — spec §5.6 derives it at read time
from the cross-group query plus `ConflictDismissal`.

| Column                  | Type            | Notes                                                                                |
| ----------------------- | --------------- | ------------------------------------------------------------------------------------ |
| `id`                    | `String`        | PK                                                                                   |
| `groupId`               | `String`        | FK → `groups.id`, cascade delete                                                     |
| `initiatorId`           | `String`        | FK → `users.id`                                                                      |
| `status`                | `MeetingStatus` | enum: `weighing` / `awaiting` / `closed` / `stuck` / `cancelled`; default `weighing` |
| `cycleCount`            | `Int`           | default `0` — the reject-and-rematch counter (spec §3.1, cap 3)                      |
| `pinnedDate`            | `Date?`         | optionally set at initiation                                                         |
| `pinnedTime`            | `String?`       | optionally set at initiation                                                         |
| `pinnedVenue`           | `String?`       | optionally set at initiation                                                         |
| `occasion`              | `String?`       | free text, an input to the Context Resolver (spec §6.2)                              |
| `currentDatetime`       | `DateTime?`     | **denormalized** — see below                                                         |
| `createdAt`/`updatedAt` | `DateTime`      |                                                                                      |

**`currentDatetime` is not in spec §6.2 verbatim.** It mirrors the datetime
of the current rank-1 `MatchOption` (or the pinned datetime, if given), kept
in sync by the application whenever a new top option is chosen. Without it,
sorting the feed by date or scanning "open meetings at time T" would need a
join through `MatchRun` → `MatchOption` on every read; with it, both are a
direct read off `meetings`.

**Relations:** many `MatchRun`, `Response`, `ParticipantMeetingContext`; two
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

**Relations:** many `MatchOption`; many `MatchRunSeenContext` (which
`ParticipantMeetingContext` rows this run saw).

**Indexes:** unique on `(meetingId, cycleNumber)`; index on `meetingId`.

### `match_options`

One of the ranked options a run produced (spec §4.1c). Only rank 1 is ever
shown to the user; ranks 2–3 are kept for the timeline, the eval set, and
the report.

| Column                      | Type               | Notes                                                                                                                                                            |
| --------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                        | `String`           | PK                                                                                                                                                               |
| `matchRunId`                | `String`           | FK → `match_runs.id`, cascade delete                                                                                                                             |
| `rank`                      | `Int`              | 1–3                                                                                                                                                              |
| `venuePlaceId`              | `String?`          | Google Places id, if resolved from a real venue                                                                                                                  |
| `venueName`, `venueAddress` | `String`/`String?` | snapshot at decision time — Places data can change later                                                                                                         |
| `venueLat`, `venueLng`      | `Float?`           |                                                                                                                                                                  |
| `proposedDatetime`          | `DateTime`         |                                                                                                                                                                  |
| `participantJustifications` | `Json`             | `userId → text`, written for that viewer specifically (spec §5.6)                                                                                                |
| `tradeoffs`                 | `Json`             | what this option costs, and for whom — persisted for the timeline/report but **never** rendered as a comparative cost line to the person who bore it (spec §5.6) |
| `createdAt`                 | `DateTime`         |                                                                                                                                                                  |

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
§3.2, §5.7). A row exists only when someone amends, and **each amendment
appends a new row** rather than overwriting the last one, so the timeline
can show which amendment triggered which re-weighing (spec §5.6).

| Column                                  | Type                        | Notes                                                                                                                                                    |
| --------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                    | `String`                    | PK                                                                                                                                                       |
| `meetingId`                             | `String`                    | FK → `meetings.id`, cascade delete                                                                                                                       |
| `userId`                                | `String`                    | FK → `users.id`, cascade delete                                                                                                                          |
| `originLat`, `originLng`, `originLabel` | `Float?`/`Float?`/`String?` | origin override for this one meeting                                                                                                                     |
| `mobilityWindows`                       | `Json`                      | mode-tagged windows — `car` / `transit` / `walk` (spec §6.2)                                                                                             |
| `softPreferences`                       | `Json?`                     | A7's correction. `NULL` is "no correction"; `{}` would read as "corrected to nothing"                                                                    |
| `rejectionText`                         | `String?`                   | the objection in the person's own words (A8)                                                                                                             |
| `rejectionOutcome`                      | `ExtractionOutcome?`        | what A7 made of **this** objection, kept per row because A8 blocks a venue wholesale for `soft`/`venue_identity` and only the hour for `time`/`distance` |
| `note`                                  | `String?`                   | free text                                                                                                                                                |
| `createdAt`                             | `DateTime`                  |                                                                                                                                                          |

**Three kinds of row, told apart by which columns are set** — and the one
free amendment per participant (spec §3.1) is counted as rows with _neither_
a correction nor a rejection, so adding a third kind here means revisiting
that count in `respondToMeeting`:

| Row                                                                     | `softPreferences` | `rejectionText` |
| ----------------------------------------------------------------------- | ----------------- | --------------- |
| an amendment                                                            | `NULL`            | `NULL`          |
| a rejection A7 could turn into a correction                             | set               | set             |
| a rejection it could not (`time`, `distance`, `venue_identity`, `none`) | `NULL`            | set             |

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
would be treated as two different dismissals. This helper does not exist
yet; write it once (e.g. `lib/db/conflict-dismissal.ts`) and route every
read/write through it.

**Indexes:** unique on `(userId, meetingAId, meetingBId)`.

---

## Enums

| Enum             | Values                                                     |
| ---------------- | ---------------------------------------------------------- |
| `MeetingStatus`  | `weighing` · `awaiting` · `closed` · `stuck` · `cancelled` |
| `ResponseStatus` | `pending` · `approved` · `cant_make_it` · `doesnt_suit`    |

---

## Deliberately not in this schema

Out of scope for F4 — belongs to a later task, not forgotten:

- **A venue cache table** — the two-tier Places cache (spec §6.3) is
  Track B, weeks 4–6 (`B7`).
- **An email/notification log** — retry and failure-recording for
  transactional email (spec §5.5, §13.10) is `B8`/`B9`.
- **A wired-up `PrismaClient`/db module** and `prisma generate` in
  `prepare`/CI — belongs to `B1`, once Postgres is actually provisioned
  and a `DATABASE_URL` exists in CI.

# Work Plan — SquadLock

This plan turns the [spec](../docs/spec.md) into work for **3 people over 8 weeks**.

The task backlog is in [tasks/todo.md](todo.md).

> **Revised for 8 weeks**, down from 12. Also revised for the design decisions recorded in [spec §4.3](../docs/spec.md) and [§5.4](../docs/spec.md): a Context Resolver that supplies parameters to a deterministic geography layer, leximin fairness, and a feed on adaptive polling. **Net effect: Track A grows back** — it reclaims the Resolver and its validation layer, having shrunk when §4.2 removed the personal agents.
>
> **Revised again for the external-services decisions in [spec §4.4](../docs/spec.md) and [§6.3](../docs/spec.md).** The MVP dependency list is now six services and no more. Gmail, the Maps JavaScript API, the Routes API and Google Calendar event creation are **out** — none of them is a dependency, a blocker, or a milestone. Calendar is an availability input on the non-sensitive `calendar.freebusy` scope; Places is billed per SKU by the fields requested, which makes the field mask Track B's most consequential decision; and whether opening hours and rating are hard constraints or ranking signals is **open**, not settled ([spec §13.4–13.7](../docs/spec.md)).

## Shape of the plan

```
Week 1        FOUNDATION (all three together)
              contracts · eval set · deploy skeleton · DB schema
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
   TRACK A                 TRACK B                 TRACK C
   Matching Agent          Data, Auth &            UI & Product
   & Rejection Loop        Calendar                Flow
        │                       │                       │
        └───────────────────────┼───────────────────────┘
                                ▼
Week 3        ★ MILESTONE 1 — thin slice, end to end, fake venues
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
   rejection loop          real venues +           meeting screen +
   Context Resolver        availability            conflict warnings
        │                       │                       │
        └───────────────────────┼───────────────────────┘
                                ▼
Week 6        ★ MILESTONE 2 — full flow, real data
                                ▼
Weeks 7-8     DOGFOODING · POLISH · REPORT
```

**Why parallel tracks with hard merge points:** three people on a strictly sequential plan means one working and two waiting. Three people on fully independent tracks means three things that never fit together. The milestones are the fix — everything must integrate on those dates, and nothing proceeds until it does.

**Why Week 1 is still shared, even at 8 weeks.** This is the week it is most tempting to compress and the one where compressing costs most. The tracks can only run in parallel if they agree on the contracts first; a day saved here is paid back with interest at the first integration. It is also where the decisions in §5.4 become types — leximin, `tolerance_km`, the sparse per-meeting context, time-aware signatures — and every one of those is a three-file refactor if it arrives in week 5 instead.

---

## What the 8-week schedule means

Twelve weeks became eight. Week 1 is contracts and weeks 7–8 are the report, so the build window is **weeks 2–6 — five weeks, with both integration milestones inside them.**

**Nothing has been cut.** Every task in [todo.md](todo.md) is in scope, including the multi-agent comparison, prompt caching, token refresh, and the notification centre. The schedule absorbs the compression through sequencing and through one deliberate piece of slack, not through scope.

**The slack is the Context Resolver** ([#52](https://github.com/ron14y-sys/squad_lock/issues/52), [#53](https://github.com/ron14y-sys/squad_lock/issues/53)). It ships dark: the validation layer falls back to the deterministic path, so an unfinished Resolver costs nothing — the system runs, the eval set still produces a number, and no other track is blocked. It is the one substantial item that can absorb a slip without leaving a hole, which is why it is scheduled into weeks 4–5 rather than earlier.

**Where the pressure actually sits.** Milestone 2 at Week 6 needs real venues, real calendars, the rejection loop _and_ cross-group conflicts, in three weeks. That is the tightest stretch in the plan, and it is the one to re-examine once Milestone 1 lands and there is a real velocity to measure against instead of an estimate.

**Two items are structurally riskier than their size suggests.** Per-meeting amendments ([#55](https://github.com/ron14y-sys/squad_lock/issues/55) and the fourth control in [#43](https://github.com/ron14y-sys/squad_lock/issues/43)) need a new entity, a new cap and UI, and — unlike the Resolver — do not degrade gracefully: a half-built control is a visibly broken control. The multi-agent comparison ([#20](https://github.com/ron14y-sys/squad_lock/issues/20)) is a second full implementation of a superseded architecture; it is the most valuable thing in the plan for the report and the least valuable for the product, so it belongs at the end, after Milestone 2, where slipping it costs the report a paragraph rather than costing the product a feature.

---

## Week 1 — Foundation (all three)

**Goal:** agree on everything the tracks need from each other, so they can then stop talking daily.

- **Shared types** — preference profile, proposal, match run, match option, response, the status vocabulary, `ResolvedContext`. Track C can build screens against them before Track A produces a real decision.
- **Database schema** — the entities in spec §6.2, including the sparse `ParticipantMeetingContext` and `ConflictDismissal`, and the `(participant, scheduled_time)` index.
- **Eval set** — 8–12 scenarios with agreed-correct answers, including the four traps in §9.
- **Deployed skeleton** — an empty app live on Vercel with a shareable URL. From here on, every merge deploys. A demo that has been live since week 1 never has a "but it worked locally" moment.
- **One measurement** — the worst-case duration of a matching run against the Vercel function timeout.
- **One decision cluster, resolved on paper** — which venue attributes are required for correctness and which are only ranking signals ([spec §13.4–13.7](../docs/spec.md)). It sets both Places field masks, and the field masks set the Places bill. Deciding it in Week 1 costs an afternoon; discovering it in Week 5 means reworking the funnel and the cache together.

**Done when:** the contracts are merged, the eval set is agreed, and there is a live URL.

---

## Track A — Matching Agent, Rejection Loop and Context Resolver

The project's novel contribution. **The rejection loop is the hard part and the part worth reporting** — plan the track around it, not around getting a first decision out.

| Weeks | Work                                                                                                                                                                                    |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2–3   | Group Matching Agent with structured output · hard-constraint filter and post-check · **leximin fairness scoring** · cost and token logging · runs against the eval set                 |
| 4–6   | **The rejection loop:** free-text reason → structured constraint update → new cycle · cycle cap · per-participant justification quality · **Context Resolver and its validation layer** |
| 7–8   | Model and effort tuning · eval runs with the Resolver on and off · report                                                                                                               |

**The one thing that must not slip:** an engine that reaches a decision, even a mediocre one, by the end of Week 3.

**Why the Resolver belongs here and not in Track B**, even though its output feeds Track B's funnel: it is the twin of the Constraint Updater. Same model, same shape — free text in, validated typed object out — same prompt, schema, and validation conventions. One person building both writes those conventions once. Build it in weeks 4–5 and ship it dark; the fallback means turning it on is a separate, later decision.

---

## Track B — Data, Auth and Calendar

The least glamorous track and the one most likely to be underestimated. OAuth always takes longer than expected.

| Weeks | Work                                                                                                                                                                                                           |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2–3   | Postgres set up and migrated · Google sign-in with **`calendar.freebusy` only** · consent screen published **In production** · groups and membership · meetings and responses · **cross-group conflict query** |
| 4–6   | Calendar free/busy read · availability · **Places Text Search (New) with explicit, minimal field masks** and two-tier caching · search area and funnel · **conflict cancellation as a transaction**            |
| 7–8   | Rate-limit and retry strategy across Places, Calendar and email · **transactional email provider — application-owned sender, retry on failure** · report                                                       |

**Start Google OAuth in Week 2.** It is the item most likely to surprise you, and at eight weeks there is no slack to absorb the surprise. The scope question is already settled: **`calendar.freebusy`, verified non-sensitive in our own Cloud Console**, so the consent screen publishes **In production** immediately and the 7-day refresh-token expiry of Testing mode never applies ([spec §6.3](../docs/spec.md)). Request nothing else — not `calendar.readonly`, not `calendar.events`, and no Gmail scope.

**One Google Cloud project, two APIs.** Calendar (per-user OAuth) and Places (a project API key) are enabled on the same project. There is no second project, and none per user ([spec §6.3](../docs/spec.md)).

**Calendar is read-only in every sense.** The MVP consumes free/busy intervals and writes nothing back. **Creating a calendar event is not in this track and not in this plan** — it needs the sensitive `calendar.events` scope and is deferred to a later phase ([spec §5.2](../docs/spec.md)). Nothing in Milestone 2 depends on it.

**Places field masks decide the Places bill.** Every Text Search call carries an explicit, minimal field mask; Enterprise-tier fields are fetched only for the ~20 shortlisted candidates; `FieldMask: *` never ships. Under SKU pricing the cost follows the fields requested, not the number of calls, so "we only call it twenty times" is not a cost argument ([spec §6.3](../docs/spec.md)).

**The email provider is not chosen yet.** Resend is the leading candidate, not a decision. What the architecture fixes is narrower: an API key held by the backend and a sender the application owns — never a participant's mailbox, and no Gmail OAuth scope ([spec §13.8](../docs/spec.md)). Buy the sending domain early; DNS verification has a waiting period that ignores milestone dates.

**Get the meeting index right in Week 1.** Conflict detection reads every open meeting for a user across every group ([spec §5.7](../docs/spec.md)). Indexing meetings by group alone is the easy default and the one that forces a migration over every row later.

---

## Track C — UI and Product Flow

The whole product surface, and where "user-friendly" is either achieved or not.

| Weeks | Work                                                                                                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2–3   | PWA shell, mobile-first · preference game · home location and tolerance · group creation and invite · **group feed with meeting cards, sorted by date** |
| 4–6   | **Meeting screen: the three blocks** · the rejection controls · **all-groups screen and conflict warnings with both escape hatches**                    |
| 7–8   | Empty, loading and error states · a stranger completes the flow unaided · report                                                                        |

**Build the meeting screen early.** Its "why this suits you" and "what happened so far" blocks are how Track A debugs, they are the most demonstrable thing in the project, and they are what makes a single agent's decision feel accountable rather than arbitrary.

**The status vocabulary is a shared contract, not styling.** It appears in the database, the API, and the UI. Agree it in Week 1 with the shared types.

**Note the change in what a proposal shows.** Each person sees why a proposal suits _them_; nobody is told what it cost them relative to a fairer option they did not get ([spec §5.6](../docs/spec.md)). Naming a cost manufactures a grievance that did not exist.

---

## Milestone 1 — Week 3: thin slice, end to end

The whole flow works with **fabricated venues and simplified profiles**: create a group → initiate → the agent matches → a proposal appears with per-person reasoning → approve. Real restaurants come later.

**This is the most important date in the plan.** A thin slice running at Week 3 leaves three weeks to deepen it. Three half-built tracks at Week 3 leaves a crisis with no room to recover.

## Milestone 2 — Week 6: full flow, real data

Real restaurants, real calendars, the rejection loop working, conflicts warned and repaired. From here, no new features — only fixing what real use reveals.

## Weeks 7–8 — Dogfooding, polish, report

**Use it yourselves, for real.** You are the target users; that is a feedback loop most student projects never get. Every time you actually want to meet, use the app. The friction you hit in real use is worth more than any test plan.

Two weeks, and they are not spare capacity for slipped features. That is what the cut list above is for.

---

## Principal Risks

| Risk                                                           | Why it's dangerous                                                                                                                                                                            | Mitigation                                                                                                                                                                                                                                              |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Eight weeks is not twelve**                                  | The plan lost a third of its build time, the design grew, and nothing was cut                                                                                                                 | One deliberate slip item that degrades gracefully because it ships dark; the report-only work sequenced last; and Milestone 2's scope re-examined once Milestone 1 gives a real velocity                                                                |
| **Three tracks that never converge**                           | The classic failure of parallel student work                                                                                                                                                  | Hard milestones; Week 1 contracts; deploy on every merge                                                                                                                                                                                                |
| **Google OAuth surprises**                                     | Consent flow is fiddly, and a scope mistake is expensive to undo after users have consented                                                                                                   | Start Week 2. The scope is settled and verified: **`calendar.freebusy`, non-sensitive**, so publish In production and skip verification entirely. Request no other scope ([spec §6.3](../docs/spec.md))                                                 |
| **Places costs more than expected**                            | Places is not "free" — it is free within per-SKU thresholds, and the SKU is set by the fields requested. One careless field mask puts every broad search into the 1,000/month Enterprise tier | Explicit minimal field masks on broad search; Enterprise fields only for the ~20-candidate shortlist; never `FieldMask: *`; neighbourhood-keyed caching; measure real call counts in Week 2 ([spec §6.3](../docs/spec.md))                              |
| **The venue pool is not the venue universe**                   | Text Search returns at most 60 provider-ranked results per query and does not guarantee identical results for identical requests, so "the best venue in the area" is not a claim we can make  | One query per participant neighbourhood rather than one wide one; expansion adds query centres; every optimality claim is scoped to the retrieved pool, in the product and in the report ([spec §5.4](../docs/spec.md))                                 |
| **A failed notification email is treated as a failed meeting** | An email provider outage would silently become a scheduling bug, and the meeting people already agreed to would appear cancelled                                                              | Notification is a side effect written after the state transition commits. An approved proposal stays approved whether or not the email lands; failures are retried and recorded ([spec §5.5](../docs/spec.md))                                          |
| **"It's just a prompt"**                                       | With one agent, a reviewer can reasonably ask what the engineering contribution is                                                                                                            | Three answers, all in writing: the rejection loop; a **deterministic fairness layer** where code does the arithmetic and the model only sets parameters (§4.1f, §4.3); and two architecture decisions made with evidence rather than taste (§4.2, §4.3) |
| **The agent quietly drops a participant**                      | Six profiles in one context, and the one whose constraint is inconvenient gets skipped                                                                                                        | Hard constraints filtered in code and re-checked after; a dedicated eval trap; per-person justification makes an omission visible                                                                                                                       |
| **A model-supplied parameter is wrong**                        | A bad radius or tolerance silently distorts every score                                                                                                                                       | Every value clamped, sanity-checked, and reversible to the deterministic path; retrieval may only widen, so the worst case is one extra query (§4.1g)                                                                                                   |
| **A conflict cancels a meeting other people already approved** | Real people are told an evening is off because of someone in another group. The worst failure the product can have, because it is social, not technical                                       | The cancelled meeting returns to weighing rather than being deleted; cancellation is one transaction across both; and the warning offers "these don't clash" so a false positive is not destructive (§5.7)                                              |
| **The rejection loop is harder than it looks**                 | Free text → constraint is the novel part, and novel means unproven                                                                                                                            | Two eval scenarios dedicated to it; if it fails, it is still a finding worth reporting                                                                                                                                                                  |
| **Scope creep**                                                | The design grew three times during specification                                                                                                                                              | Spec §11 is the answer to every "should we also…", and the cut list above is the answer to "can we still fit…"                                                                                                                                          |

## Priority order

**Contracts → engine that decides → thin slice live → rejection loop → real data → polish.**

One narrow product that works beats five half-built ones.

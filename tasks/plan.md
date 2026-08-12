# Work Plan — SquadLock

This plan turns the [spec](../docs/spec.md) into work for **3 people over ~12 weeks**. It replaces the earlier single-threaded plan, which would have left two people idle at any moment.

The task backlog is in [tasks/todo.md](todo.md).

> **Revised 2026-08-12, twice.** First for the architecture change in [spec §4.2](../docs/spec.md) — one matching agent replaces the personal-agent negotiation, which shrinks Track A. Then for the interface decisions in [spec §5.6–5.7](../docs/spec.md) — a feed of meeting cards, several meetings in parallel, and conflict detection across groups. **Net effect: work moved from Track A to Tracks B and C.** Track C now owns three screens instead of a decision screen plus a viewer, and Track B owns a cross-group query that shapes the schema.

## Shape of the plan

Three tracks running in parallel, joined by hard integration milestones:

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
Week 4-5      MILESTONE 1 — thin slice, end to end, fake venues
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
   rejection loop          real venues +           full flow +
   fairness tuning         availability            meeting screen
        │                       │                       │
        └───────────────────────┼───────────────────────┘
                                ▼
Week 9        MILESTONE 2 — full flow, real data
                                ▼
Week 10-12    DOGFOODING · POLISH · REPORT
              (optional: multi-agent comparison — spec §4.2)
```

**Why parallel tracks with hard merge points:** three people on a strictly sequential plan means one working and two waiting. Three people on fully independent tracks means three things that never fit together. The milestones are the fix — everything must integrate on those dates, and nothing proceeds until it does.

**Why Week 1 is shared:** the tracks can only run in parallel if they agree on the contracts between them first. One week of the three of you defining shared types and the database schema buys eight weeks of independent work.

---

## Week 1 — Foundation (all three)

**Goal:** agree on everything the tracks need from each other, so they can then stop talking daily.

- **Shared types** — the TypeScript contracts every track codes against: preference profile, proposal, match run, match option, decision, rejection. Track C can build screens against them before Track A produces a real decision.
- **Database schema** — the entities in spec §6.2.
- **Eval set** — 8–12 scenarios with agreed-correct answers, including two with no perfect solution and two with rejection reasons.
- **Deployed skeleton** — an empty app live on Vercel with a shareable URL. From here on, every merge deploys. A demo that has been live since week 1 never has a "but it worked locally" moment.
- **One measurement** — the worst-case duration of a matching run against the Vercel function timeout (spec §13.4). Small now that it is a single streamed call, but the number belongs on paper before Track A builds on the assumption.

**Done when:** the contracts are merged, the eval set is agreed, and there is a live URL.

---

## Track A — Matching Agent and Rejection Loop

Still the project's novel contribution, but the risk has moved. The matching agent itself is now a few days of work, not weeks. **The rejection loop is the hard part and the part worth reporting** — plan the track around it, not around getting a first decision out.

| Weeks | Work |
|---|---|
| 2–4 | Group Matching Agent with structured output · hard-constraint filter and post-check · distance fairness scoring · cost and token logging · runs against the eval set |
| 5–8 | **The rejection loop:** free-text reason → structured constraint update → new cycle · cycle cap · fairness tuning against eval results · per-participant justification quality |
| 9–12 | Model tuning (can Haiku hold six profiles at once, or does this need Sonnet?) · effort tuning · prompt caching across cycles · **optional:** build the superseded multi-agent variant and run both on the eval set (spec §4.2) |

**The one thing that must not slip:** an engine that reaches a decision, even a mediocre one, by Week 4. Everything else depends on it — and it should now arrive earlier than Week 4, which is the point of the change.

**Where the freed time goes:** Track C, which grew to own three screens and the conflict warnings, and dogfooding. Not into new features.

---

## Track B — Data, Auth and Calendar

The least glamorous track and the one most likely to be underestimated. OAuth always takes longer than expected.

| Weeks | Work |
|---|---|
| 2–4 | Postgres set up and migrated · Google sign-in · groups and membership · meetings and responses · **cross-group conflict query** |
| 5–8 | Google Calendar read · availability computation for a set of participants · venue provider integration with caching · **conflict cancellation as a transaction** |
| 9–12 | Email delivery · reliability and error handling on external calls |

**Start Google OAuth in Week 2, not Week 5.** It is the item most likely to surprise you, and finding that out in Week 5 costs the schedule.

**Get the meeting index right in Week 1.** Conflict detection reads every open meeting for a user across every group ([spec §5.7](../docs/spec.md)). Indexing meetings by group alone is the easy default and the one that forces a migration over every row later.

---

## Track C — UI and Product Flow

The track that grew. It now owns the whole product surface — three nested screens and the entire status vocabulary — and this is where "user-friendly" is either achieved or not. Give it the capacity freed from Track A.

| Weeks | Work |
|---|---|
| 2–4 | PWA shell, mobile-first · preference game · home location · group creation and invite · **group feed with meeting cards, sorted by date** |
| 5–8 | **Meeting screen: the three blocks** · two rejection buttons · **all-groups screen and conflict warnings** · in-app notifications |
| 9–12 | Polish, empty states, loading states, error states · everything a stranger hits that you never do |

**Build the meeting screen early.** Its "why this suits you" and "what happened so far" blocks are how Track A debugs, they are the most demonstrable thing in the project, and after the §4.2 change they are what makes a single agent's decision feel accountable rather than arbitrary. They got more important, not less.

**The status vocabulary is a shared contract, not styling.** `waiting on you` / `waiting on N` / `re-weighing` / `conflicting` / `stuck` / `closed` appear in the database, the API, and the UI. Agree them in Week 1 with the shared types.

---

## Milestone 1 — Week 4–5: thin slice, end to end

The whole flow works with **fabricated venues and simplified profiles**: create a group → propose → confirm → the agent matches → decision appears with per-person reasoning → approve. Real restaurants come later.

**This is the most important date in the plan.** A thin slice that runs at Week 5 leaves seven weeks to deepen it. Three separate half-built tracks at Week 5 leaves a crisis.

## Milestone 2 — Week 9: full flow, real data

Real restaurants, real calendars, the rejection loop working. From here, no new features — only fixing what real use reveals.

## Weeks 10–12 — Dogfooding, polish, report

**Use it yourselves, for real.** You are the target users; that is a feedback loop most student projects never get. Every time you actually want to meet, use the app. The friction you hit in real use is worth more than any test plan.

Reserve the last two weeks for the report and the demo. Not one week.

---

## Principal Risks

| Risk | Why it's dangerous | Mitigation |
|---|---|---|
| **Three tracks that never converge** | The classic failure of parallel student work | Hard milestones; Week 1 contracts; deploy on every merge |
| **Google OAuth surprises** | Sensitive scope, fiddly consent flow | Start Week 2; Testing mode; read-only scope |
| **"It's just a prompt"** | The new headline risk. With one agent, a reviewer can reasonably ask what the engineering contribution is | The contribution is the rejection loop, the deterministic fairness layer, and the §4.2 decision made with evidence — not the agent count. Say so early and in writing |
| **The agent quietly drops a participant** | Six profiles in one context, and the one whose constraint is inconvenient gets skipped | Hard constraints filtered in code and re-checked after (spec §4.1b); a dedicated eval trap scenario; per-person justification makes an omission visible |
| **A conflict cancels a meeting other people already approved** | Real people are told an evening is off because of someone in another group. The worst failure the product can have, because it is social, not technical | The cancelled meeting returns to weighing rather than being deleted (spec §5.7), so the others get a new time instead of a cancellation notice. Cancellation must be one transaction across both meetings |
| **Decision quality is mediocre** | "Algorithmic trade-off" can produce results that read as arbitrary | Eval set from Week 1; the viewer makes reasoning inspectable |
| **The rejection loop is harder than it looks** | Free text → constraint is the novel part, and novel means unproven | Two eval scenarios dedicated to it; if it fails, it is still a finding worth reporting |
| **Scope creep** | The flow already has 11 feature areas | Spec §11 is the answer to every "should we also…" |

## Priority order

**Contracts → engine that decides → thin slice live → rejection loop → real data → polish.**

One narrow product that works beats five half-built ones.

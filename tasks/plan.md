# Work Plan — Multi-Agent Activity Coordination

This document translates the [spec](../docs/spec.md) into a phased work plan. The guiding idea: **don't build everything at once — prove the heart of the system works, then expand.** Each phase builds on the last, and each has an explicit "done" condition so it is easy to tell when to move on.

Governing principle: **a brutally minimal MVP** — 3 users, one activity type (restaurants), coordination on time and place only. Everything else (more domains, more activity types, vector DB, multiple APIs) is deliberately deferred.

---

## Open Decisions — settle before Phase 0

Three questions that shape the architecture. While they are open, coding cannot start.

**1. How do Python and Next.js divide the work?**
The spec mandates Python + LangChain/CrewAI, but the existing repo (`squad_lock`) is an empty Next.js 16 scaffold.
Recommendation: **two separate components** — a Python agent backend (Phases 1–3), and Next.js as the real UI shell (Phase 4). The current repo is the future UI; agent code lives in a separate Python project.

**2. What exactly counts as a "good decision"?**
Not a philosophical question but a measurement definition. Without it there is no way to know whether Phase 1 succeeded. See Phase 0.

**3. Who does what, and on what timeline?**
The plan defines phases but not people or dates. Each phase needs an owner and a time estimate.

---

## Phase 0 — Setup and Alignment

**Goal:** get concrete and remove ambiguity before writing a line of code.

- **Build an eval set of 8–12 scenarios** before writing the engine. Each scenario: 3 user profiles + the answer we agree is correct, and why. This is what turns "a good decision" from a vague notion into something measurable — and it is the yardstick for every phase from here on.
  - At least two scenarios must have **no perfect solution** — that is where the Consensus Coordinator is genuinely tested.
- Lock the MVP boundaries: 3 users, restaurants only, and what is deliberately *out*.
- Set up a shared development environment (Git, Python 3.10+) and provision one LLM API key.

**Done when:** an agreed-upon eval-set file exists, and there is a repo with a "hello world" that runs and talks to the LLM.

---

## Phase 1 — Negotiation Engine Prototype (the heart)

**Goal:** prove the core idea works at all. This is the most novel and least certain part, so it comes first.

- Write a simple script (no UI, no DB, no calendar) in which 3 Personal User Agents with fabricated profiles negotiate to a decision.
- Implement a first version of the Consensus Coordinator: collect proposals, rank by a group utility function, handle the trade-off case.
- **Run it against the Phase 0 eval set** — not a one-off manual check.

### Three technical decisions that save pain later

**a. Inter-agent messages are structured output, not free text.**
If agent A sends B free text and B parses it, any change in phrasing breaks the flow. Use structured outputs (`output_config.format` with a JSON Schema) — the API guarantees the output matches the schema. Free text stays in the user-facing interface only.

**b. A round cap.**
The negotiation needs a hard cap (say 5 rounds). Without one, two agents can keep talking until the budget is gone. No solution within N rounds → return the best trade-off found so far.

**c. Measure cost from day one.**
Log tokens and dollar cost for every full negotiation. This is the number that determines whether the product is viable. If one negotiation costs $0.40, the system will not survive a real audience — and it is far better to learn that in Phase 1 than in Phase 5.

**Done when:** the script runs against every eval scenario, reaches the agreed answer in most cases, and there is a known figure for the cost and latency of a single negotiation.

---

## Phase 2 — Connecting to the Real World

**Goal:** make proposals concrete and real rather than fabricated.

- Build a first version of the World Interface Agent.
- Connect **exactly one external API** (Google Places or Yelp) to pull real restaurants.
- Feed the real results into the Phase 1 negotiation engine.
- Add caching for API results — the same query should not go out twice.

**Done when:** agents negotiate over restaurants that exist in the real world. The eval set still passes.

---

## Phase 3 — Infrastructure: Calendar and Data

**Goal:** connect the system to real users and persist state.

- Google Calendar integration (OAuth / Sign in with Google).
- PostgreSQL for user profiles and preferences.
- Everything still runs locally — **no cloud and no vector DB** (deliberately deferred).

> ⚠️ **A known OAuth trap.** Calendar access is a sensitive scope requiring verification from Google — a process that takes weeks. **The MVP does not need it:** set the app to "Testing" mode, add team members as test users (up to 100), and everything works. Verification is only required before exposing the product to a real audience. Plan for this now so it does not ambush you at the end.

**Done when:** a real user signs in with Google, the system reads their availability, and their profile persists across restarts.

---

## Phase 4 — User Experience and End-to-End Wiring

**Goal:** turn the components into a single flow a person can actually use.

- **Visual prototype** (base44 / lovable / Claude), including the preference-selection game. This can and should start **in parallel from Phase 1** — it clarifies what the system needs to do, and it is a one-off throwaway.
- **The real UI** is built in the Next.js repo, not in the prototyping tool. These are two different things: the prototype is a thinking tool, the Next.js app is the product.
- Wire the full chain: profile setup → availability lookup → negotiation → final proposal.

**Done when:** a complete coordination can be run end to end through an interface, with 3 real users.

---

## Phase 5 — Cloud and Polish

**Goal:** get the system off a personal laptop and stabilize it.

- Deploy to GCP (Cloud Run + Cloud SQL).
- Move from the cheap model to the stronger one where evaluation shows it pays off — **a measurement-driven decision, not a gut call**.
- Polish, error handling, and testing with real users.

**Done when:** the system runs in the cloud and is usable outside the development environment.

---

## Correction: Models and Costs

> ⚠️ **The LLM section of the spec was out of date.** Claude 3.5 Sonnet and Claude 3.5 Haiku have been **retired** — calls to them return 404. The pricing there belonged to a generation that no longer exists. Current state below.

| Model | ID | Input / Output per 1M tokens | Context |
|---|---|---|---|
| Claude Opus 5 | `claude-opus-5` | $5 / $25 | 1M |
| Claude Sonnet 5 | `claude-sonnet-5` | $3 / $15 (promo: $2 / $10 through 2026-08-31) | 1M |
| Claude Haiku 4.5 | `claude-haiku-4-5` | $1 / $5 | 200K |

**Recommended mapping** — the strategy in the spec was right, only the names changed:

- **Development and repeated runs:** `claude-haiku-4-5`
- **Production:** `claude-sonnet-5` — close to Opus quality on agentic work at a third of the price
- **Only if evaluation shows a real gap:** `claude-opus-5`

### Two mechanisms that cut cost dramatically

**Prompt caching.** In negotiating agents, every repeated call carries the same system prompt and the same preference profile. Caching that prefix costs 1.25× on write and **0.1× on read** — roughly a 90% discount on the repeated portion. In a system where agents talk a lot, this is the difference between viable and not. Watch the minimum cacheable prefix: 512 tokens on Opus 5, 1,024 on Sonnet 5, and 4,096 on Haiku 4.5 — anything shorter simply is not cached, with no error raised.

**The `effort` parameter.** Controls reasoning depth and token spend (`low` / `medium` / `high` / `xhigh` / `max`). Routine negotiation is fine at `low` or `medium`; save the higher settings for complex trade-off cases.

### A note on the cloud choice

"GCP because it supports Claude via the Anthropic API" is not a reason — the Anthropic API is callable from any cloud and any machine. **The real reasons for GCP stand on their own:** Cloud Run is essentially free during development, $200 monthly credit for the Places API, and Google Calendar API in the same console. No need to lean on a bad argument.

---

## Principal Risks

| Risk | Why it's dangerous | Mitigation |
|---|---|---|
| **Negotiation cost** | Agents that talk a lot mean a bill that grows fast, discovered late | Measure from Phase 1; round cap; prompt caching |
| **Decision quality** | "Algorithmic trade-off" sounds good on paper and may produce results that read as arbitrary | Phase 0 eval set, including scenarios with no perfect solution |
| **OAuth verification** | Sensitive scope; Google verification takes weeks | Testing mode for the MVP; plan verification in advance |
| **Split stack** | Python + Next.js means two projects, two environments | Settle open decision #1 before Phase 1 |
| **Scope creep** | The spec lists 4 expansion domains and 4 APIs | Breadth comes only after one slice runs end to end |

---

## Priority Order in Brief

**Eval set → negotiation engine → real API → calendar + DB → end-to-end UX → cloud.**

Breadth — more domains (B2B, travel, community, study), more activity types, vector DB — comes **only after** the single slice runs end to end. One narrow product that works beats five half-built ones.

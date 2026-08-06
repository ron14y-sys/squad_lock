# Spec — SquadLock

> A multi-agent system for coordinating content-driven social activities.

This document is the project's source of truth. It is a living document: every architectural decision and scope change is recorded here **before** it is implemented in code. The phased work plan lives in [tasks/plan.md](../tasks/plan.md).

---

## 1. Introduction

### 1.1 Purpose

The system solves group-scheduling by automating the negotiation between participants. Unlike classic scheduling tools, it runs **personal agents** that represent each user's interests, constraints, and content preferences, and negotiate their way to agreement on activity type, location, and time.

### 1.2 Target Users

Groups of friends, work teams, and families who want to coordinate a shared activity (restaurant, movie, outing) with minimal manual back-and-forth.

### 1.3 Core Domain and Roadmap

**Core domain (MVP):** leisure-activity coordination for groups. Activity types: restaurants, movies, bars, picnics, and short outings. The central value is full automation of the negotiation over time, place, and content, cross-referencing hard constraints (kosher, allergies) against soft preferences (budget, style).

**Future expansion.** The multi-agent mechanism is generic and extends cleanly:

| Domain | Description | Integration required |
|---|---|---|
| Corporate events (B2B) | Team offsites, workshops, multi-participant meetings | Microsoft Teams / Outlook |
| Travel planning | Full multi-day itineraries abroad | Booking.com / Skyscanner |
| Community meetups | Connecting people with shared interests into new groups | — |
| Study groups | Coordinating study sessions around academic workloads | — |

> Expansion comes **only after** one vertical slice runs end to end. See Boundaries (section 10).

---

## 2. Market Analysis and Differentiation

### 2.1 Existing Alternatives

| Category | Examples | How it works | Core limitation |
|---|---|---|---|
| Classic scheduling | Calendly, Google Calendar | Finds an open time slot on a calendar | Built for business meetings; no understanding of activity content, preferences, or constraints |
| Content recommendation | Yelp, TripAdvisor, Google Maps | Information and reviews about venues | Coordination, negotiation, and group sync remain entirely manual |
| Polls and voting | Doodle, WhatsApp Polls | Group votes on candidate dates | Manual and tedious; ignores complex constraints (kosher, budget, allergies) |

### 2.2 Unique Value Proposition

A shift from "manual helper tool" to **autonomy via personal agents**:

1. **Fully automated group negotiation** — agents represent their users and negotiate to agreement without manual intervention.
2. **Multi-layered preference handling** — hard constraints (kosher, allergies, fixed hours) cross-referenced against soft preferences (budget, atmosphere, music), plus habits learned from the calendar.
3. **Conflict resolution (Consensus Coordinator)** — a group utility function ranks proposals, and an algorithmic trade-off resolves cases with no perfect answer.
4. **Grounding in real-world data (World Interface Agent)** — proposals are validated against external APIs: weather, venue availability, opening hours.
5. **Deep semantic understanding** — parses free-form intent rather than matching keywords.

---

## 3. System Architecture

A distributed multi-agent system with three components:

| Component | Responsibility | Owns |
|---|---|---|
| **Personal User Agent** | An autonomous agent per user; represents their interests in the negotiation | Preference profile + calendar access |
| **Consensus Coordinator** | Runs the negotiation, collects proposals, ranks them by a group utility function | Negotiation state, round cap |
| **World Interface Agent** | Queries external sources to produce concrete proposals | API connections + caching |

### 3.1 Binding Decisions on Inter-Agent Communication

Two decisions settled at the spec level, not left to implementation-time judgment:

**a. Messages between agents are structured output, not free text.**
Every inter-agent message is defined by a JSON Schema and enforced via structured outputs (`output_config.format`). Free text appears only in the user-facing interface. Parsing free text between agents is brittle: any change in phrasing breaks the flow.

**b. The negotiation has a hard round cap.**
Default: 5 rounds. No solution within the cap → return the best trade-off found so far. Without a cap, two agents can keep talking until the budget is gone.

---

## 4. Functional Requirements

### 4.1 Preference Profile Management

Users define **hard constraints** (kosher, allergies, fixed hours) and **soft preferences** (cuisine, music, budget, atmosphere).

Initial profile setup runs as a **this-or-that game**:

> "Loud bar or quiet café?" · "Hike in nature or a museum tour?" · "Student budget or once-in-a-lifetime splurge?"

The value: the agent gets an initial set of soft preferences immediately, without a long and tedious form.

### 4.2 Calendar Sync and Habit Learning

Pulls free time from Google Calendar / Outlook. Beyond availability, the agent analyzes past events:

- **Schedule analysis** — a user who hits the gym every day at 07:00 → the agent infers a hard constraint the user never stated.
- **Locations** — analysis of the areas where the user usually spends time.

### 4.3 Dynamic Content Proposals

Cross-references three sources: everyone's availability · shared content preferences · external data (weather, venue availability).

### 4.4 Conflict Resolution

When no perfect option exists, agents settle on an algorithmic trade-off — for example, picking the restaurant that is everyone's second choice over one person's first choice and everyone else's fifth.

---

## 5. Technical Requirements

### 5.1 Core Technologies

| Component | Choice | Rationale |
|---|---|---|
| Language | Python 3.10+ | Broad ecosystem for AI and agent libraries |
| Agent framework | LangChain Agents or CrewAI | Implementing LLM-backed agents |
| LLM | See section 5.4 | The "brain" behind semantic decision-making |
| UI | Next.js 16 + React 19 + Tailwind v4 | The existing repo; built in a later phase |

> ⚠️ How Python and Next.js divide the work is an **open question** — see section 12.

### 5.2 Data Management

- **PostgreSQL** — user data, preference profiles, negotiation history.
- **Vector DB** — semantic preference history ("this user enjoyed summer hikes"). **Deliberately deferred until after the MVP.**

### 5.3 External APIs

| API | Role | Pricing | Note |
|---|---|---|---|
| Google Calendar | Availability lookup | Free under reasonable usage | Requires OAuth 2.0 — see warning below |
| Google Places | Restaurant and venue data | $200 free credit monthly; beyond that ~$7–$32 per 1,000 requests | The free credit covers all of development and the MVP |
| Yelp Fusion | Alternative or supplement to Places | Free up to 5,000 requests/day | Particularly strong for restaurants and nightlife |
| OpenWeather | Gating outdoor activities on weather | 1,000 calls/day free; beyond that $0.0015/call | Decides between a picnic and an indoor venue |

> ⚠️ **OAuth warning.** Access to private calendars is a sensitive scope and cannot use a simple API key — it requires a "Sign in with Google" flow. Full verification from Google takes weeks. **The MVP does not need it:** set the app to "Testing" mode and add team members as test users (up to 100). Verification is only required before exposing the product to a wider audience — plan for it in advance.

**The MVP connects exactly one external API** (Places or Yelp). The rest are deferred.

### 5.4 Language Models and Costs

> ⚠️ **Correction against earlier drafts:** Claude 3.5 Sonnet and Claude 3.5 Haiku have been **retired** (28 Oct 2025 and 19 Feb 2026 respectively) — calls to them return 404. Any pricing that references them is obsolete.

| Model | ID | Input / Output per 1M tokens | Context |
|---|---|---|---|
| Claude Opus 5 | `claude-opus-5` | $5 / $25 | 1M |
| Claude Sonnet 5 | `claude-sonnet-5` | $3 / $15 (promo: $2 / $10 through 2026-08-31) | 1M |
| Claude Haiku 4.5 | `claude-haiku-4-5` | $1 / $5 | 200K |

**Mapping for this project:**

- **Development and repeated runs:** `claude-haiku-4-5`
- **Production:** `claude-sonnet-5` — close to Opus quality on agentic work at a third of the price
- **Only if evaluation proves a real gap:** `claude-opus-5`

**Two mandatory cost mechanisms:**

1. **Prompt caching.** In a system where agents negotiate, every call repeats the same prefix (system prompt + preference profile). Caching costs 1.25× on write and **0.1× on read** — roughly a 90% discount on the repeated portion. Minimum cacheable prefix: 512 tokens on Opus 5, 1,024 on Sonnet 5, and **4,096 on Haiku 4.5** — anything shorter silently fails to cache, with no error.
2. **The `effort` parameter.** Controls reasoning depth and token spend (`low` / `medium` / `high` / `xhigh` / `max`). Routine negotiation runs at `low`–`medium`; higher settings are reserved for complex trade-off cases.

---

## 6. Cloud Environment

**GCP (Google Cloud Platform).**

| Service | Role | Estimated MVP cost |
|---|---|---|
| Cloud Run | Hosting the agent application | ~$0 — serverless; no charge when idle |
| Cloud SQL (PostgreSQL) | Database | ~$10–$15/month (`db-f1-micro`) — the main fixed cost |
| Cloud Tasks / Pub-Sub | Queues and async processing | Free (generous free tier) |

**Rationale:** simple interface · Cloud Run for container management · low starting budget · $200 monthly credit for Places API · Google Calendar API in the same console.

> Rationale removed: "supports Claude via the Anthropic API" is not a reason to pick a cloud — the API is callable from any cloud and any machine.

---

## 7. Commands

**Frontend (Next.js — the current repo):**

```
dev:    npm run dev
build:  npm run build
lint:   npm run lint
```

**Agent backend (Python):** to be defined after open question #1 is settled (section 12). There is no `test` script on either side yet — see section 9.

---

## 8. Project Structure

Current state:

```
app/            → Next.js App Router (layout, page, globals.css)
docs/           → Spec and decision records
tasks/          → Work plan and task list
public/         → Static assets
.agents/skills/ → Shared skills for development agents
```

The Python backend structure will be defined after open question #1 is settled.

---

## 9. Testing Strategy

**The eval set is a required deliverable of Phase 0** — before a single line of the negotiation engine is written.

- 8–12 scenarios, each with: 3 user profiles + the agreed-upon correct answer + the reasoning behind it.
- **At least two must have no perfect solution** — that is where the Consensus Coordinator is genuinely tested.
- The eval set is re-run at every phase, not only Phase 1.

**Metrics collected on every run:** scenario pass rate · dollar cost per full negotiation · wall-clock time per negotiation · actual round count.

Beyond that: unit tests for the group utility function and constraint parsing (deterministic logic — no LLM needed to test it).

---

## 10. Boundaries

**Always:**
- Measure cost and tokens on every negotiation, from day one.
- Enforce a round cap on every negotiation loop.
- Run the eval set before merging any change to the decision engine.
- Use structured outputs for every inter-agent message.

**Ask first:**
- Changing the database schema.
- Adding a new dependency or another external API.
- Moving to a more expensive model.
- Any expansion beyond the core domain (section 1.3).

**Never:**
- Commit API keys, secrets, or OAuth tokens to the repo.
- Access real calendar data for anyone outside the team before Google verification is in place.
- Run a negotiation without a round cap.
- Add expansion domains before one slice runs end to end.

---

## 11. MVP Success Criteria

The definition of "done" for the minimum product. **The numeric targets are a proposal pending team agreement** (see open question #2):

1. Three real users sign in with Google, and the system reads their availability.
2. The system returns an **existing** restaurant (from a real API) that satisfies all three users' hard constraints.
3. The eval set passes on ≥ 80% of scenarios.
4. A full negotiation completes in ≤ 60 seconds.
5. A full negotiation costs ≤ $0.10.
6. When no perfect solution exists, the system returns a trade-off **with an explanation** of why it was chosen — rather than failing.

---

## 12. Open Questions

| # | Question | Why it blocks | Recommendation |
|---|---|---|---|
| 1 | How do Python and Next.js divide the work? | The spec mandates Python; the repo is an empty Next.js scaffold. Affects project structure, deployment, and CI | Two separate components: a Python agent backend, with Next.js as the UI in Phase 4 |
| 2 | What are the target values in the success criteria? | The numbers in section 11 are a proposal, not an agreement | Confirm or revise during Phase 0 |
| 3 | Who owns what, and what is the timeline? | The plan defines phases but not people or dates | Attach an owner and a time estimate to each phase |
| 4 | LangChain or CrewAI? | Both are listed as alternatives; neither has been chosen | Decide in Phase 0, after a short spike on both |

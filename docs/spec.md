# Spec — SquadLock

> An agentic system for coordinating social activities. A single matching agent holds the whole group's profiles at once and returns one reasoned proposal; free-text rejection drives the next cycle.

This document is the project's source of truth. It is a living document: every architectural decision and scope change is recorded here **before** it is implemented. The confirmed intent behind it is in [docs/intent/squadlock.md](intent/squadlock.md); the phased work plan is in [tasks/plan.md](../tasks/plan.md).

---

## 1. Introduction

### 1.1 Purpose

The system replaces the 40-message group chat about where to meet. Users define preferences and connect a calendar; a **single matching agent** receives every confirmed participant's profile together and resolves them into a date, a time, and a venue; the group receives one proposal with the reasoning behind it, and approves or rejects it.

### 1.2 Target Users

Groups of 3–6 friends coordinating a night out. Not organizations, not work teams.

### 1.3 Core Domain and Roadmap

**Core domain (v1):** restaurant coordination for small friend groups — date, time, and venue.

**Future expansion.** The matching mechanism is generic and extends to corporate events (Teams/Outlook), travel planning (Booking/Skyscanner), community meetups, and study groups. **None of these are built until one slice runs end to end.**

---

## 2. Market Analysis and Differentiation

### 2.1 Existing Alternatives

| Category | Examples | How it works | Core limitation |
|---|---|---|---|
| Classic scheduling | Calendly, Google Calendar | Finds an open time slot | Built for business meetings; no understanding of activity content or constraints |
| Content recommendation | Google Maps, Easy (easy.co.il), Yelp, TripAdvisor | Venue information, reviews, and filters | Coordination and group sync remain entirely manual; the user does the cross-referencing |
| Polls and voting | Doodle, WhatsApp Polls | Group votes on candidate dates | Manual and tedious; ignores complex constraints (kosher, budget, allergies) |

### 2.2 Unique Value Proposition

1. **Free-text rejection as a learning signal** — "this place isn't to my taste" is not a button. It is parsed into a structured constraint update that drives the next matching cycle. **This is the project's central novel mechanism**, and after the architecture change in §4.2 it is unambiguously the thing the project is about.
2. **One agent that holds the whole group at once** — not a recommender run per person and not a poll. A single agent reasons over every participant's hard constraints, soft preferences, location, and calendar simultaneously, and must justify its choice per participant.
3. **Multi-layered preferences** — hard constraints (kosher, allergies, fixed hours) crossed against soft preferences (budget, atmosphere, cuisine), plus habits learned from the calendar.
4. **Grounding in real data** — proposals validated against live APIs: venue availability, opening hours, weather.

---

## 3. The End-to-End User Flow

This flow is the specification. Everything else in this document serves it.

1. **Onboarding** — user signs in with Google, connects their calendar, and defines hard constraints and soft preferences (via the this-or-that game, §5.1) plus a home neighborhood (§5.4).
2. **Group** — user creates a group and invites friends by email. A user belongs to several groups.
3. **Initiation** — a member presses **"I want to arrange a get-together"**. Nothing has to be filled in; date, time, and venue may optionally be pinned, but the empty case is the default path, not a degraded one.
4. **Matching** — the candidate funnel (§5.4) produces a shortlist, and the matching agent receives every group member's profile, location, and availability together. It returns a ranked set of options over date, time, and venue. **No humans participate in this step.** There is no separate step asking who wants to come — step 6 absorbs it.
5. **Proposal** — the top option appears as a **card in the group feed** (§5.6). Every member sees the same venue and time, and their **own** reason it suits them, plus what it costs them.
6. **Response** — each member either approves or takes one of **two distinct rejections** (§3.2). Only one proposal is ever on screen; the lower-ranked options stay internal.
7. **Re-weighing** — rejection reasons are parsed into structured constraint updates and a new matching cycle begins from step 4, up to the cap.
8. **Confirmation** — once everyone still in has approved, the card closes and all participants are notified.

**Deferred to later versions:** automatic restaurant reservation (step 9) and a day-before reminder (step 10).

### 3.1 Three Mandatory Caps

- **Reject-and-rematch cycles** — default 3 per meeting. Exceeded → the meeting enters the `stuck` state: the best option is shown with an explanation and the group decides manually. Without this cap, a group loops indefinitely and people abandon.
- **Open meetings per group** — default 3. Beyond it, the initiate button is disabled with an explanation. Without this cap, the feed becomes a to-do list and members stop responding at all.
- **One proposal on screen at a time.** Not a numeric cap but a hard rule: showing the ranked options side by side turns the product back into a poll, which is the thing it replaces.

There is no round cap: a matching run is a single agent call, not a multi-round exchange.

### 3.2 The Two Rejections

A single "reject" button would carry two incompatible meanings, and the agent cannot act on the ambiguity.

| Button | Meaning | Effect | Counts toward the cycle cap? |
|---|---|---|---|
| **"I can't make it"** | I am unavailable, regardless of the plan | Drops the user from this meeting's calculation only. Group membership is untouched; they receive the next meeting normally | **No** — they did not ask for a different option, they left |
| **"Something here doesn't work for me"** | I'm in, the proposal is wrong | The free text becomes a structured constraint and enters the next weighing | **Yes** — one of three |

Without the split, the agent spends a scarce re-weighing trying to please someone who was never coming.

---

## 4. System Architecture

| Component | Responsibility | Owns | LLM? |
|---|---|---|---|
| **Candidate Funnel** | Search area → venues → drop hard-constraint violations → fairness/rating pre-rank → shortlist | Candidate selection | No — deterministic |
| **Group Matching Agent** | Receives every confirmed participant's profile, location, and availability *together* with the shortlist; returns a ranked set of options, each justified per participant | The decision | Yes |
| **World Interface** | Queries Google Places and Google Calendar; caching | API connections | No |
| **Conflict Detector** | Finds time collisions among **all of a user's open meetings across every group** (§5.7) | Nothing — derived on read | No — deterministic |
| **Constraint Updater** | Parses free-text rejections into structured constraint updates | Rejection history per participant | Yes |

One agent makes the decision. Everything that can be computed deterministically — the search area, the hard-constraint filter, the distance fairness scores — is computed in code and handed to the agent as input, not left to its judgment.

### 4.1 Binding Decisions

**a. Agent input and output are structured, not free text.**
The agent's output is defined by a JSON Schema and enforced via structured outputs (`output_config.format`). Free text appears only at the human boundary — the rejection reason coming in, and the rationale going out. Parsing an LLM's prose into a decision is brittle: any change in phrasing breaks the flow.

**b. Hard constraints are enforced in code, never delegated to the agent.**
A kosher-only participant or a nut allergy is filtered out at the funnel, before the agent sees a single candidate, and the agent's chosen option is re-checked against every hard constraint after it answers. A model that "mostly" respects an allergy is not acceptable, and a single agent holding six profiles at once has more opportunity to drop one than a filter does.

**c. The agent returns a ranked set, not a single answer.**
It returns the top 3 options, each with an explicit statement of what it trades away and for whom. **Only rank 1 is ever shown to the user** (§3.1); the others stay internal. They cost almost nothing extra, they give the decision history something to say about what was passed over, and they may let a rejection be answered without a new run (§13.7).

**d. Every matching run is persisted in full.**
The shortlist that went in, the ranked options that came out, the per-participant justification, the chosen option, and the cycle number — recorded from the first day. This is impossible to reconstruct retroactively, it powers the viewer, and it is the raw material for the report.

**e. A matching run may stream inside a request; it no longer needs a background job.**
A single agent call over a shortlist of ~15 venues takes seconds, not the 30–90 that a multi-round negotiation took. The route streams the response and reports progress from the deterministic stages. The Vercel function timeout still has to be checked against a real worst case and written down (§13.4), but the background-job infrastructure this architecture used to require is no longer needed.

### 4.2 Recorded Decision — one agent, not personal agents per participant

**Superseded design.** Earlier drafts specified one Personal User Agent per participant negotiating against a Consensus Coordinator over capped rounds. That is no longer the architecture.

**Why it changed.** Decomposing a task into agents pays off when the context does not fit in one window or when there is real parallelism to exploit. Neither applies here: six preference profiles, fifteen candidate venues, and a set of calendar openings fit comfortably in one context. Splitting them means each agent reasons from a partial view and communicates through a lossy channel, which costs decision quality rather than buying it. The single-agent design is also roughly an order of magnitude cheaper and fast enough to run inside a request.

**What it cost.** The negotiation was the project's original headline. Two things go with it: the idea that a personal agent *represents* you, which is a real product property and not only theatre, and a claim that reads as more ambitious on a slide. Both were traded deliberately for a system that decides better and ships.

**Worth reporting.** This decision, with the reasoning above, belongs in the report. If time remains after Milestone 2, building the multi-agent variant and running both against the same eval set (§9) turns the assumption into a measured result — an optional stretch, not a v1 requirement.

---

## 5. Functional Requirements

### 5.1 Preference Profile

**Hard constraints** (kosher, allergies, fixed unavailable hours) and **soft preferences** (cuisine, budget, atmosphere, noise level, travel tolerance).

Each user also sets a **home location** — see §5.4.

Initial setup runs as a **this-or-that game**: "Loud bar or quiet café?" · "Hike in nature or a museum tour?" · "Student budget or once-in-a-lifetime splurge?" — the agent gets an initial preference set immediately, without a long form.

### 5.2 Calendar

Google Calendar, **read-only scope**, v1 only. Availability is computed for confirmed participants only.

Beyond raw availability, the agent may infer habits from past events (a 07:00 gym slot every weekday is effectively a hard constraint). **Habit inference is a stretch goal, not v1.**

### 5.3 Groups and Proposals

Groups of 3–6. Invitation by email. A proposal carries optional `date`, `time`, and `venue` fields plus a free-text note; any subset may be present.

### 5.4 Location and Distance

Distance is a first-class factor in the matching, not an afterthought. A venue that is perfect on every other axis but an hour away for one participant is not a good group decision.

**Home location.** Each user sets a home location during onboarding, stored at **neighborhood granularity, not a street address** — enough for the distance calculation, and it avoids holding precise home addresses for a group of friends. Home is the default travel origin; a user can override it per proposal ("I'm coming from work today").

**Fairness over averages.** The scoring minimizes the **worst** travel burden across participants, not the average. Averaging lets a group repeatedly pick venues next door to three people and far from the fourth; that person stops showing up. This is the same fairness principle as open question §13.2 and is one of the more defensible design choices to write up in the report.

**Straight-line distance for v1.** Travel time is the honest metric — 3 km can be ten minutes or forty — but it requires a routing API, which is another integration and another cost. v1 computes straight-line distance from coordinates: free, instant, and a good enough proxy at city scale. Routing is a documented upgrade path, not a v1 requirement (§11).

**Search area — the union of participants' neighborhoods and their surroundings.** Candidates are drawn from every participant's own neighborhood plus the neighborhoods around each of them, not from a single computed midpoint. This sidesteps the failure mode of centroid approaches, where the geometric middle of four friends lands in a park, an industrial zone, or the sea. It also degrades gracefully for a dispersed group: instead of one meaningless central point you get several real clusters, and the fairness scoring picks between them.

Implementation note: "the neighborhoods around X" is modeled as a **radius around the neighborhood's center**, not as a true adjacency graph. Adjacency would require a dataset we do not have and would have to maintain; a radius produces the same result from the coordinates Google Places already gives us.

**Candidate funnel.** The search area can easily yield hundreds of venues, and handing all of them to the agent is both slow and expensive. The pipeline narrows before the agent sees anything:

```
search area → all venues → filter out hard-constraint violations
            → pre-rank by distance fairness and rating
            → top N (start at ~15) → matching agent
```

Only the final shortlist reaches the agent, and each candidate arrives with its per-participant distance already computed. The funnel is deterministic code, not an LLM — it is cheap, testable, and keeps the expensive reasoning focused on the choice that actually requires judgment. It is also the enforcement point for hard constraints (§4.1b): a venue that violates one never reaches the agent at all.

### 5.5 Notifications

**v1: in-app + email.** Email carries the link; everything else happens in the app. Web push is deferred — on iOS it only works after the user adds the PWA to their home screen, which is friction we do not want in the critical path.

### 5.6 The Interface — a feed of meeting cards

**There is no free-form conversation.** The group looks like a chat, but only the agent posts, and members respond through defined controls. This was chosen deliberately over an open chat: a conversational surface would require real-time messaging and an agent that decides when to speak and when to stay quiet, and neither is necessary for the product to work.

**Three screens, in order of nesting:**

| Screen | Shows |
|---|---|
| **All groups** | Every group the user belongs to, with a count of what awaits them in each, plus a single timeline of all their open meetings across groups. Exists because conflict detection is cross-group (§5.7) |
| **Group feed** | The group's meetings as cards, **sorted by date, nearest first**. Past meetings fall below a divider. The initiate button sits at the bottom, disabled at the 3-meeting cap |
| **Meeting** | One meeting in full — see the three blocks below |

**Sorted by date, with status as a label.** Chronological order is what people expect of anything with a date on it. The cost is that the item needing action can land mid-list, so a card awaiting the viewer gets the brand color on both its date block and its edge — the eye finds it while scanning even when it is third.

**Status vocabulary.** `waiting on you` · `waiting on N others` · `re-weighing` · `conflicting` · `stuck` · `closed`. Only `waiting on you` gets the brand color; if everything is emphasized, nothing is. `conflicting` is derived at read time, not stored — it is a property of the user's whole schedule, not of the meeting.

**Three blocks inside a meeting:**

1. **The proposal** — venue, date, time, an expandable *"why this suits you"* written for the viewer specifically, and an explicit line naming what it costs them. The trade-off line is required: without it the justification reads like advertising and stops being believed by the third proposal.
2. **Where it stands** — a progress bar, a one-line summary ("1 of 2 approved"), and every participant with their state and timestamp. Members who dropped out stay listed rather than disappearing, so nobody wonders whether they were asked.
3. **What happened so far** — a timeline: who initiated, what was proposed, who rejected and why, which weighing is running.

Blocks 1 and 3 replace what a separate reasoning viewer would have shown. With a single agent deciding, there is no visible argument to watch — the per-person justification and the decision history are what make the outcome accountable rather than arbitrary. **"Why this and not that" is the product, not a debug view.**

### 5.7 Conflicting Meetings

Several meetings run in parallel, and a user belongs to several groups, so two proposals can land on the same evening in two different groups.

**The check is a user-level query, not a group-level one.** It runs over every open meeting the user has, in every group. This is the single most consequential requirement in this section for the data layer: it needs meetings indexed by *user and time*, not only by group.

**Rules:**

- A detected conflict is surfaced in three places: a banner on the feed, a `conflicting` label on the row, and a warning strip **directly above the approve button**. It must be impossible to approve without having seen it.
- **Approving one meeting automatically cancels the conflicting one.** A single transaction writing to two meetings in two groups — not two calls that can half-fail.
- **A cancelled meeting is not deleted. It returns to weighing**, with the user who caused the cancellation marked "can't make it", and the agent proposes a new time to the others. This matters because the others may have already approved: cancellation is something the system repairs, not something it merely announces.

---

## 6. Technical Requirements

### 6.1 Stack

| Component | Choice | Rationale |
|---|---|---|
| Language | TypeScript, end to end | One language, one deployment; the team already works in it |
| Framework | Next.js 16 (App Router) + React 19 | The existing repo |
| Styling | Tailwind v4 | Already configured |
| Delivery | PWA, mobile-first | Friends coordinating a night out do it on a phone |
| Hosting | Vercel | Already connected; free at this scale |
| LLM | Anthropic API (TypeScript SDK) | See §6.4 |
| Database | PostgreSQL | See §6.3 |

> Next.js 16 differs from earlier versions. Consult `node_modules/next/dist/docs/` before writing framework code — see [AGENTS.md](../AGENTS.md).

### 6.2 Data Model

Core entities. Field lists are indicative, not final:

| Entity | Purpose |
|---|---|
| `User` | Identity, Google tokens |
| `PreferenceProfile` | Hard constraints + soft preferences per user, including home location (lat/lng at area granularity) and travel tolerance |
| `Group` / `GroupMember` | Group and its membership |
| `Meeting` | One get-together from initiation to close. Carries the group, the initiator, optional pinned date/time/venue, the cycle counter, and a status: `weighing` / `awaiting` / `closed` / `stuck` / `cancelled`. **Indexed by participant and scheduled time** — this is what makes the cross-group conflict query (§5.7) possible |
| `MatchRun` | One weighing cycle of a meeting; carries cycle number, the shortlist that went in, and the constraint updates that triggered it |
| `MatchOption` | One of the ranked options a run produced: venue, datetime, rank, per-participant justification, what it trades away. Only rank 1 is ever shown |
| `Response` | Per-user, per-meeting: `pending` / `approved` / `cant_make_it` / `doesnt_suit` + free-text reason + timestamp. The two rejection kinds are distinct values, not a boolean with a note (§3.2) |

### 6.3 External Services

| Service | Role | Cost | Note |
|---|---|---|---|
| Google OAuth + Calendar | Sign-in and availability | Free at this scale | Read-only scope. See OAuth warning below |
| **Google Places** | Real restaurant data — the v1 source | $200 free credit/month, sufficient for development and the demo | Also supplies the coordinates the distance calculation needs (§5.4). Check the terms on caching and attribution before building the cache |
| Easy (easy.co.il) | Candidate enrichment source — **blocked** | Unknown | Israeli local search with restaurant filters that map unusually well to our constraints: kosher type, vegetarian, vegan, child-friendly, atmosphere. **No public API documentation found** as of Aug 2026. Ask them directly; do not scrape. Only integrate if they grant access — see §13.1 |
| PostgreSQL | Persistence | Free tier sufficient | Managed Postgres on Vercel or an equivalent provider |
| Email delivery | Invitations and notifications | Free tier sufficient | Transactional email provider |

> ⚠️ **OAuth warning.** Calendar access is a sensitive scope requiring Google verification — a process that takes weeks. **v1 does not need it:** set the app to "Testing" mode and add users as test users (up to 100). Verification is only required before a wider release. Request the minimum scope now: broadening it later is easy, narrowing it after users have consented is not.

### 6.4 Language Models and Cost

> ⚠️ **Correction against earlier drafts:** Claude 3.5 Sonnet and Claude 3.5 Haiku have been **retired** (28 Oct 2025 and 19 Feb 2026). Calls to them return 404.

| Model | ID | Input / Output per 1M tokens | Context |
|---|---|---|---|
| Claude Opus 5 | `claude-opus-5` | $5 / $25 | 1M |
| Claude Sonnet 5 | `claude-sonnet-5` | $3 / $15 (promo: $2 / $10 through 2026-08-31) | 1M |
| Claude Haiku 4.5 | `claude-haiku-4-5` | $1 / $5 | 200K |

**Mapping:** `claude-haiku-4-5` for development and repeated runs · `claude-sonnet-5` for the demo and real use · `claude-opus-5` only if evaluation proves a gap.

The matching agent is the one place where model choice actually matters — it does all the reasoning in the system, and there is no second agent to catch its mistakes. Start it on Sonnet 5 and only try to move it down to Haiku 4.5 once the eval set can prove the drop is safe. The Constraint Updater is a small extraction task and can sit on Haiku 4.5 from the start.

**Prompt caching.** Across the cycles of one proposal, the prefix (system prompt + the participants' profiles) repeats while only the constraint updates change. Caching costs 1.25× on write and **0.1× on read**. Minimum cacheable prefix: 512 tokens on Opus 5, 1,024 on Sonnet 5, **4,096 on Haiku 4.5** — anything shorter silently fails to cache, with no error. Note that a single-agent run makes far fewer calls than the superseded design did, so caching now matters mainly across cycles rather than within a run.

**The `effort` parameter.** Routine matching at `low`–`medium`; higher settings reserved for complex trade-off cases.

**Why cost is measured.** At this scale the bill is a few dollars total and is not a business concern. Cost per decision is tracked because **"what does a good group decision cost" is a research finding** worth reporting — and because it is half the evidence for the §4.2 architecture decision.

---

## 7. Commands

```
dev:    npm run dev
build:  npm run build
lint:   npm run lint
test:   not yet configured — see §9
```

---

## 8. Project Structure

```
app/            → Next.js App Router — routes and pages
docs/           → Spec and decision records
docs/intent/    → Confirmed statements of intent
tasks/          → Work plan and backlog
public/         → Static assets
.agents/skills/ → Shared skills for development agents
```

Directories for agent code, the data layer, and shared types are added as the tracks in [tasks/plan.md](../tasks/plan.md) land.

---

## 9. Testing Strategy

**The eval set is a required deliverable of Week 1** — before the matching engine is written.

- 8–12 scenarios. Each: 3–6 participant profiles, their calendars, and the answer we agree is correct, with reasoning.
- **At least two must have no perfect solution.**
- **At least two must include a rejection reason** and the expected follow-up proposal — this is the mechanism the project is built around, so it must be measured, not just demonstrated.
- **At least one must contain a hard-constraint trap:** the highest-scoring venue on every other axis violates one participant's hard constraint. The correct answer is never that venue (§4.1b).
- Re-run on every change to the engine.

**Metrics per run:** scenario pass rate · dollar cost per decision · wall-clock time · cycles used · hard-constraint violations (must be zero).

**Unit tests** for the deterministic layer: distance fairness scoring, the hard-constraint filter, constraint parsing, availability computation, search-area derivation. No LLM required to test these.

The eval set does not change with the §4.2 architecture — it describes correct answers, not how they are reached. That is exactly why it was written first, and it is what would make an eventual multi-agent comparison a fair one.

---

## 10. Boundaries

**Always:**
- Persist every matching run in full — inputs, ranked options, and the choice.
- Enforce all three caps (§3.1).
- Filter hard constraints in code, and re-check the agent's answer against them.
- Use structured outputs for every agent response.
- Run the conflict check across **all** of a user's groups, never within one.
- Write a conflict cancellation as one transaction across both meetings.
- Run the eval set before merging a change to the engine.

**Ask first:**
- Changing the database schema.
- Adding a dependency or an external service.
- Moving to a more expensive model.
- Anything beyond the v1 scope in §11.

**Never:**
- Commit API keys, secrets, or OAuth tokens.
- Request a broader calendar scope than read-only.
- Run a rejection loop without the cycle cap.
- Rely on the agent alone to respect a hard constraint.
- Show more than one proposal at a time.
- Cancel a meeting silently, or delete one instead of returning it to weighing.
- Build an expansion domain before one slice runs end to end.

---

## 11. Explicitly Out of Scope for v1

Apple Calendar and Outlook · restaurant reservations · day-before reminders · web push notifications · any activity type other than restaurants · vector DB · habit inference from calendar history · all expansion domains (B2B, travel, community, study) · native mobile app · **travel-time routing** (v1 uses straight-line distance — §5.4) · **the Easy integration** unless they grant API access in time (§13.1) · **personal agents per participant and multi-round negotiation** (superseded — §4.2; optional post-Milestone-2 comparison only) · **free-form conversation in the group** (§5.6 — the feed is a structured surface, not a chat) · **showing the user more than one proposal at a time** (§3.1) · **a separate participation-confirmation step** (§3.2 absorbs it).

---

## 12. Success Criteria

1. A friend receives an emailed link, signs in with Google, and completes a profile in under a minute.
2. A group of 3+ can create a proposal with any subset of date, time, and venue specified.
3. The system returns an **existing** restaurant that satisfies every participant's hard constraints, fits every confirmed participant's calendar, and is reachable for all of them — no participant is left with a travel burden far worse than the rest.
4. A free-text rejection produces a materially different next proposal that visibly addresses the stated reason.
5. The eval set passes on ≥ 80% of scenarios, including the rejection-loop scenarios, with **zero hard-constraint violations** across all of them.
6. A matching run completes in ≤ 20 seconds, with visible progress throughout.
7. Every decision shows, per participant, why it works for them and what it costs them.
8. A user with meetings in two groups on the same evening is warned before approving either, and approving one repairs the other rather than dropping it.
9. The whole flow runs on a phone, and a stranger completes it without help.

> Targets 5 and 6 are proposals to validate against the first working engine, not fixed requirements. The 20-second figure replaces the 90 seconds the superseded multi-agent design needed (§4.2) — if the real number lands far above it, that is a finding about the architecture, not just a slow run.

---

## 13. Open Questions

| # | Question | Status |
|---|---|---|
| 1 | Can we get API access to Easy (easy.co.il)? | **Blocked on them.** Email them in Week 1 — it is a one-hour task with a potentially large payoff, and the answer arrives on their schedule, not ours. Build on Google Places regardless; treat Easy as enrichment that may never land |
| 2 | How much of the fairness trade-off is deterministic scoring versus the agent's judgment? | Open — the core design question after §4.2. §5.4 commits to minimizing the worst travel burden, which is computable. Whether the agent receives those scores as advice or as a binding ranking decides how much room it has to be creative — and how much room it has to be unfair |
| 3 | How does the feed refresh — polling, or a live connection? | Open. The feed is not a chat (§5.6), so seconds of staleness are acceptable and polling is probably enough. Decide before Track C builds the feed, because it is awkward to retrofit |
| 4 | What is the real worst-case duration of a matching run, and does it fit the Vercel function timeout? | Open — measure it in Week 1 against the chosen plan's limit and write the number down. Much smaller than it was: streaming inside a request is now the expected answer (§4.1e) |
| 5 | What radius counts as "the neighborhoods around" a participant? | Open — a number, not a design. Tune it against your own real addresses; too small starves the candidate list, too large defeats the point |
| 6 | How many candidates enter the matching run? | Open — start at ~15 and tune against eval-set quality and cost (§5.4, candidate funnel) |
| 7 | Does a rejection always trigger a new run, or first try the unused options from the current one? | Open — §4.1c keeps ranks 2 and 3. Answering from them is instant and free, but risks feeling dismissive if the objection was not really addressed |
| 8 | How much time overlap counts as a conflict? | Open — a number, not a design. Two meetings four hours apart on the same evening are probably still a conflict once travel is counted. Start with "same day, within N hours" and tune (§5.7) |

**Resolved during specification:**

- ~~One personal agent per participant, negotiating?~~ → **No. One Group Matching Agent** holding every profile at once (§4.2). The superseded design cost decision quality, money, and latency without buying anything the context window did not already provide.
- ~~Show the group one proposal or the ranked three?~~ → **One.** Three on screen is a poll, which is what the product replaces (§3.1).
- ~~Is the group a real chat?~~ → **No.** A structured feed of meeting cards; only the agent posts (§5.6).
- ~~Does a separate participation-confirmation step remain?~~ → **No.** The two rejection buttons absorb it (§3.2).
- ~~One active meeting per group, or several?~~ → **Several, capped at 3.** Sorted by date, nearest first.
- ~~Is conflict detection within a group or across groups?~~ → **Across every group the user belongs to** (§5.7). This is what created the "all groups" screen.
- ~~What happens to a meeting cancelled by a conflict?~~ → **It returns to weighing**, it is not deleted.
- ~~Google Places or Yelp Fusion?~~ → **Google Places.** Supplies both venue data and the coordinates the distance calculation needs; the free credit covers development and the demo.
- ~~How is the search area derived?~~ → **The union of participants' neighborhoods and their surroundings** (§5.4). Not a centroid.
- ~~Does travel origin default to home?~~ → **Yes, with a per-proposal override.**
- ~~Distance or travel time?~~ → **Straight-line distance for v1.**

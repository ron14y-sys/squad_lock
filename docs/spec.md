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
4. **Grounding in real data** — proposals validated against live sources: **opening hours and business status** from Google Places, real calendar availability, and real coordinates for the distance calculation. Table availability and weather are **not** obtainable at v1 scope — see §11.

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
- **Context amendments per participant per meeting** — default 1 free. A second amendment by the same person costs a re-weighing cycle. An amendment is a correction to the *input* (§3.2), so charging the first one would punish someone for giving the system information it lacked; leaving it uncapped would let a single participant spend the group's runs without limit.

There is no round cap: a matching run is a single agent call, not a multi-round exchange.

### 3.2 The Two Rejections

A single "reject" button would carry two incompatible meanings, and the agent cannot act on the ambiguity.

| Button | Meaning | Effect | Counts toward the cycle cap? |
|---|---|---|---|
| **"I can't make it"** | I am unavailable, regardless of the plan | Drops the user from this meeting's calculation only. Group membership is untouched; they receive the next meeting normally | **No** — they did not ask for a different option, they left |
| **"Something here doesn't work for me"** | I'm in, the proposal is wrong | The free text becomes a structured constraint and enters the next weighing | **Yes** — one of three |
| **"My situation tonight is different"** | I'm in, the proposal is fine — the facts about *me* changed | Writes a `ParticipantMeetingContext` row (origin, mobility window) and triggers a re-weighing after the batching window | **No** — see below |

Without the split, the agent spends a scarce re-weighing trying to please someone who was never coming.

**Why the third control does not spend a cycle.** It is a correction to the *input*, not a rejection of the *output*. "I have no car tonight" is not "this proposal is wrong" — it is information the system never had. Charging it a cycle is the same category error the two-button split exists to fix. It is bounded instead by the amendment cap in §3.1.

**Amendments are batched, not immediate.** An amendment opens a ~90-second window; further amendments reset it; when it closes, **one** run covers all of them. Amendments cluster — several people open the same proposal within the same two minutes — so firing immediately would run the match twice and replace a proposal before anyone finished reading it. The window is closed lazily by the next feed poll (§5.6), so this needs no cron and no background job.

---

## 4. System Architecture

| Component | Responsibility | Owns | LLM? |
|---|---|---|---|
| **Context Resolver** | Turns messy human facts — free-text tolerance, "no car tonight", "coming from work", an occasion note, adjacent neighbourhoods, barriers like a motorway with no crossing — into **bounded numeric parameters** for the deterministic layer. Runs once per meeting, before the search. Never sees a venue | Nothing — its output is validated, clamped, and discardable | Yes |
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

**f. The model sets parameters; code runs the function.**
Where judgement is genuinely needed on something that is *not* a fact — how far "a bit" is for this person tonight, whether two neighbourhoods are really one area — an LLM supplies a **bounded, typed parameter** and deterministic code then runs unchanged. The model never performs arithmetic, never sorts a candidate set, and never returns a distance. This is what keeps a global guarantee global: `argmin` still runs over every candidate.

**g. The model may only widen retrieval. It may narrow only in scoring.**
Narrowing at retrieval is irreversible — a venue never fetched cannot be recovered by any later stage, including the rejection loop. Narrowing at scoring is recoverable — a venue ranked low is still in the set and can rise in the next cycle. So the Context Resolver may add search regions, merge them, or enlarge a radius; it may never remove one or shrink below the deterministic baseline. It may freely shrink a tolerance, because that only moves a candidate down a list. **The worst case of a bad model output is therefore an extra Places query, never a starved candidate set.**

### 4.2 Recorded Decision — one agent, not personal agents per participant

**Superseded design.** Earlier drafts specified one Personal User Agent per participant negotiating against a Consensus Coordinator over capped rounds. That is no longer the architecture.

**Why it changed.** Decomposing a task into agents pays off when the context does not fit in one window or when there is real parallelism to exploit. Neither applies here: six preference profiles, fifteen candidate venues, and a set of calendar openings fit comfortably in one context. Splitting them means each agent reasons from a partial view and communicates through a lossy channel, which costs decision quality rather than buying it. The single-agent design is also roughly an order of magnitude cheaper and fast enough to run inside a request.

**What it cost.** The negotiation was the project's original headline. Two things go with it: the idea that a personal agent *represents* you, which is a real product property and not only theatre, and a claim that reads as more ambitious on a slide. Both were traded deliberately for a system that decides better and ships.

**Worth reporting.** This decision, with the reasoning above, belongs in the report. Building the multi-agent variant and running both against the same eval set would turn the assumption into a measured result. It is in scope, scheduled after Milestone 2 — the point in the plan where slipping it would cost the report a paragraph rather than cost the product a feature. §4.3 provides evidence of the same kind independently, by running the eval set with the Context Resolver on and off.

### 4.3 Recorded Decision — an LLM in the geography layer, as parameters only

**What was considered.** Whether the search area and the distance layer should be computed deterministically or handed to a model.

**Why it changed.** A fixed radius around each participant cannot serve both a dense-centre group and a dispersed one, and straight-line distance does not know that two neighbourhoods are effectively one area, or that three kilometres across a motorway with no crossing is not three kilometres. Those are real defects and a model is genuinely better at them.

**What was rejected, and why.** Handing the model the geometry or the arithmetic. It would estimate 320 haversine distances confidently and wrongly, approximate a sort instead of performing one — which dissolves the minimise-the-worst-burden guarantee rather than weakening it — and remove the unit tests that make a failing eval scenario attributable to a stage. It would also inflate the cost-per-decision figure that §6.4 exists to report, with arithmetic a library does for free.

**The resolution** is §4.1f and §4.1g: the model supplies parameters, code runs the function, and the invariant makes a bad parameter cheap instead of dangerous. The Resolver is an enhancement layer with a full fallback to the deterministic baseline — which also means the eval set can be run with it on and off, turning this decision into a measured delta rather than a matter of taste.

**Worth reporting.** The deterministic fairness layer is one of the three things that answer "isn't this just a prompt?" — alongside the rejection loop and the §4.2 decision. Keeping the arithmetic in code and giving the model the parameters is what preserves that answer while still getting the semantic geography.

---

## 5. Functional Requirements

### 5.1 Preference Profile

**Hard constraints** (kosher, allergies, fixed unavailable hours) and **soft preferences** (cuisine, budget, atmosphere, noise level, travel tolerance).

Each user also sets a **home location** and a **travel tolerance in kilometres** — see §5.4. The tolerance is presented as a labelled slider ("on foot · the neighbourhood · half the city · anywhere"); the stored value is kilometres, because a 1–5 scale is an invisible mapping table nobody remembers by week 6, while kilometres can be unit-tested and printed back to the user.

**Recurring mobility rules** — "no car on Fridays", "Tuesdays I come from work" — are part of the profile, not of any single meeting. They are distinct from the fixed unavailable hours above: those affect *availability*, these affect *distance*. They are also the cheap half of §5.7's amendment mechanism, because most of what varies is predictable and, once in the profile, is applied to the **first** proposal rather than to a correction of it.

Initial setup runs as a **this-or-that game**: "Loud bar or quiet café?" · "Hike in nature or a museum tour?" · "Student budget or once-in-a-lifetime splurge?" — the agent gets an initial preference set immediately, without a long form.

### 5.2 Calendar

Google Calendar, v1 only. Availability is computed for confirmed participants only.

**The scope is `calendar.freebusy`, not `calendar.readonly`.** v1 needs to know *when someone is busy*, never *what they are busy with* — the availability computation in §5.4 consumes free/busy intervals and nothing else. Requesting the narrower scope is not only §10's minimum-scope rule; it appears to be what keeps the app out of Google's verification process entirely. See §6.3.

Beyond raw availability, the agent may infer habits from past events (a 07:00 gym slot every weekday is effectively a hard constraint). **Habit inference is a stretch goal, not v1.**

### 5.3 Groups and Proposals

Groups of 3–6. Invitation by email. A proposal carries optional `date`, `time`, and `venue` fields plus a free-text note; any subset may be present.

### 5.4 Location and Distance

Distance is a first-class factor in the matching, not an afterthought. A venue that is perfect on every other axis but an hour away for one participant is not a good group decision.

**Home location.** Each user sets a home location during onboarding, stored at **neighbourhood granularity, not a street address** — enough for the distance calculation, and it avoids holding precise home addresses for a group of friends. Home is the default travel origin; it can be overridden per meeting (§5.7). The coarse granularity turned out to pay twice: it is also what makes the venue cache shared across meetings and users (§6.3).

**The burden of a venue on a person.**

```
burden = straight_line_distance × detour_factor / tolerance_km
```

Dimensionless. `1.0` means exactly at the limit that person stated; `1.4` means half again as far as they are comfortable with. The detour factor is described below.

**Fairness is leximin over burdens.** Sort every participant's burden from worst to best and compare candidates lexicographically: worst against worst, and only on a tie move to the second-worst, then the third.

```
[1.8, 1.2, 0.9]  beats  [1.8, 1.5, 0.4]      — tie on the worst, decided on the second
```

Plain minimax — comparing only `max(burden)` — is what §5.4 originally described, and it is degenerate: two candidates with the same worst-off participant are exactly equivalent to it, even when one is far better for everyone else, so ties get broken downstream by star rating and the fairness silently disappears. Leximin is the standard refinement of maximin in social choice theory, it costs about five lines, and its name is worth a paragraph in the report.

**Why worst-case and not average.** Averaging lets a group repeatedly pick venues next door to three people and far from the fourth; that person stops showing up. Leximin is jumpy — a small change for the worst-off participant reorders everything — and that is a feature for the rejection loop, where §12.4 requires the next proposal to be *materially* different.

**Straight-line distance, corrected.** Travel time is the honest metric but requires a routing API — another integration and another cost, and out of scope for v1 (§11). v1 uses straight-line distance from coordinates, multiplied by a **detour factor** supplied per region-pair by the Context Resolver: `1.0` by default, higher where two areas are geographically close but practically far (a motorway or a river with no crossing between them). This is a cheap approximation of routing, sits honestly between the two, and can be measured against both.

**Search area — the union of participants' neighbourhoods and their surroundings.** Candidates are drawn from every participant's own neighbourhood plus the area around each of them, not from a single computed midpoint. This sidesteps the failure mode of centroid approaches, where the geometric middle of four friends lands in a park, an industrial zone, or the sea. It also degrades gracefully for a dispersed group: instead of one meaningless central point you get several real clusters, and the fairness scoring picks between them.

Implementation note: "the area around X" is modelled as a **radius around the neighbourhood's centre**, not a true adjacency graph. Adjacency would require a dataset we do not have and would have to maintain.

⚠️ **A local search API returns a capped number of results per query, not everything in an area.** Earlier drafts of this section said the area "can easily yield hundreds of venues" and that the funnel starts from "all venues in the area". Neither is true: what you get is top-K per query, by the provider's own ordering. Two consequences follow, and both shape the design:

1. **One query per participant neighbourhood**, deduplicated — a single wide bounding query returns the same capped count spread over a larger area, which means worse coverage near each individual participant, and the dispersed group is exactly the case the union geometry exists to serve.
2. **Adaptive expansion adds query centres, it does not enlarge the radius.** A larger radius under a result cap trades near venues for far ones rather than returning more. Adding a centre is also pure widening, which is what §4.1g requires; enlarging a radius is not.

**Candidate funnel.**

```
per-neighbourhood queries → dedupe → drop hard-constraint violations
   → drop anything open at no viable time (§5.7)
   → gate: drop any candidate where some participant's burden exceeds T
   → top N/2 by leximin  +  top N/2 by rating   (overlap frees slots)
   → shortlist of N ≈ 20–24 → matching agent
```

The funnel is deterministic code, not an LLM. It is cheap, testable, and keeps the expensive reasoning focused on the choice that actually requires judgement. It is also the enforcement point for hard constraints (§4.1b).

**Why fairness gates rather than being weighted against rating.** A weighted sum of a fairness score and a star rating requires an exchange rate between kilometres and stars, which does not exist, and it lets an excellent rating buy its way past unfairness — the thing this section exists to prevent. So fairness acts as a **gate** (beyond `T`, a venue is simply unreachable for someone and is dropped) and then the shortlist is filled from **two parallel ranked lists**, one by leximin and one by rating. Where the two agree, a venue occupies one slot instead of two and frees room for the next. The agent then sees both ends of the trade-off and decides between them, which is exactly the division of labour in §4.1f.

**The agent is advised by the fairness ranking, not bound by it.** Every candidate that survives the gate is *valid*, and choosing among valid options is the agent's job. It may prefer a better-rated venue over the leximin leader. The gate is where fairness is enforced; above it, fairness is an input.

**Every distance question is really a (venue, time) question.** A mobility window ("no car between 18:00 and 21:00") and a venue's opening hours both depend on when the meeting is, so the funnel scores `candidates × participants × time slots`, not `candidates × participants`. For a handful of common free slots this is a few hundred cells — trivial to compute. The pre-rank uses each participant's **most permissive** slot, so that time-dependence never narrows what gets retrieved (§4.1g); the agent, which chooses the slot, receives the per-slot tolerances, and its chosen pair is re-checked against all of them afterwards.

### 5.5 Notifications

**v1: in-app + email.** Email carries the link; everything else happens in the app. Web push is deferred — on iOS it only works after the user adds the PWA to their home screen, which is friction we do not want in the critical path.

**Mail is sent from a dedicated project address**, never from a participant's own mailbox — see §6.3 for why that rules out the Gmail API.

**Email fires on state changes that need a person, not on internal steps.** A weighing cycle is not an event a user needs told about; a proposal waiting on them is. The v1 triggers:

| Trigger | Why it earns an email |
|---|---|
| Group invitation | It is how somebody joins at all (§12.1) |
| A proposal is waiting on you | Without it nobody knows to open the app |
| The meeting is confirmed | The point of the whole flow — a date, time and place are now real |
| Your meeting returned to weighing after a conflict cancelled it | §5.7 calls this the worst failure the product can have; the repair has to be visible, not silent |
| The meeting is `stuck` | Otherwise it goes quiet and the group never settles it |

Deliberately **not** emailed: each re-weighing, each individual response, and anything the feed already shows on next open. Three cycles across three open meetings is nine possible emails per person per group — enough to teach people to filter the sender.

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

1. **The proposal** — venue, date, time, and an expandable *"why this suits you"* written for the viewer specifically.

   **No comparative cost line.** Earlier drafts required each person to be told what the proposal costs *them* relative to a fairer alternative. That was dropped deliberately: naming a cost manufactures a grievance that did not exist. Yoav would not have noticed the extra fifteen minutes until we told him he had drawn the short straw. Naming a *constraint* is not the same as naming a *comparison* — "a twenty-five minute ride for you" is a fact, "twenty minutes worse for you than the fairest option" is a complaint we planted.

   The honesty that the trade-off line was there to provide comes instead from framing that acknowledges limits without ranking people against each other: *"the quietest place we found that fits everyone's calendars."* The agent still computes and persists what each option trades away and for whom (§4.1c) — that feeds the timeline, the eval set, and the report. It is simply never shown to the person who bore the cost.
2. **Where it stands** — a progress bar, a one-line summary ("1 of 2 approved"), and every participant with their state and timestamp. Members who dropped out stay listed rather than disappearing, so nobody wonders whether they were asked.
3. **What happened so far** — a timeline: who initiated, what was proposed, who rejected and why, which weighing is running, which amendments triggered a re-weighing ("re-weighed because Dana has no car tonight"), and what was passed over. The unused ranks 2 and 3 (§4.1c) surface here — *"we also considered X and Y"* — which is the job §4.1c actually assigns them.

**How the feed refreshes: adaptive polling.** A meeting in `re-weighing` on screen polls every ~3 seconds; otherwise every ~30 seconds; backgrounded, not at all. The initiator gets live progress for free, because the matching streams inside her own still-open request (§4.1e) — that is one request answered gradually, not a second channel. A held-open connection was rejected: it bills by duration on a serverless host, needs a pub/sub service to fan one user's action out to others (§10, "ask first"), and brings reconnection and mobile-backgrounding work for a product where seconds of staleness are acceptable by design. Polling only ever has to cover the foreground; email carries the rest (§5.5). The same poll is what closes the amendment batching window (§3.2), so amendments need no scheduler either.

Blocks 1 and 3 replace what a separate reasoning viewer would have shown. With a single agent deciding, there is no visible argument to watch — the per-person justification and the decision history are what make the outcome accountable rather than arbitrary. **"Why this and not that" is the product, not a debug view.**

### 5.7 Conflicting Meetings

Several meetings run in parallel, and a user belongs to several groups, so two proposals can land on the same evening in two different groups.

**The check is a user-level query, not a group-level one.** It runs over every open meeting the user has, in every group. This is the single most consequential requirement in this section for the data layer: it needs meetings indexed by *user and time*, not only by group.

**Rules:**

**What counts as a conflict:** two open meetings of the same user **on the same calendar day, less than 4 hours apart**. A meeting has a start but no duration (§6.2), so literal interval overlap is not even computable; and two dinners three hours apart on the same evening are a conflict once travel is counted, whatever the clock says. Four hours is a number to tune, not a design.

**The cost of a false positive is higher than a false negative here**, because a detected conflict triggers a cancellation. A definition that is too eager does not merely nag — it takes an evening away from people in another group who had already agreed to it.

**Rules:**

- A detected conflict is surfaced in three places: a banner on the feed, a `conflicting` label on the row, and a warning strip **directly above the approve button**. It must be impossible to approve without having seen it.
- **The warning offers two ways out, not one.** *"These don't clash — keep both"* and *"One of these needs to change"*. Without an escape hatch the only available actions are to approve (destroying the other meeting) or to do nothing, and with a 4-hour rule there will be false positives — someone who really can go from drinks at 18:00 to dinner at 21:00. **A dismissal is persisted** per user and meeting pair, or the warning returns on the next poll and every reload. *The exact shape of these two controls is deliberately left to be refined when the screen is built.*
- **Approving one meeting automatically cancels the conflicting one.** A single transaction writing to two meetings in two groups — not two calls that can half-fail.
- **A cancelled meeting is not deleted. It returns to weighing**, with the user who caused the cancellation marked "can't make it", and the agent proposes a new time to the others. This matters because the others may have already approved: cancellation is something the system repairs, not something it merely announces.

**Per-meeting context.** What varies for one evening — "no car between 18:00 and 21:00", "I'm coming from work today" — is recorded as a sparse `ParticipantMeetingContext` row and feeds the Context Resolver at a higher priority than the recurring rules in §5.1, which in turn outrank the profile default. There is deliberately **no step before matching where everyone declares their situation**: that is the participation-confirmation step §3.2 exists to absorb, and it would replace "press one button and a proposal appears" with a synchronous wait. Instead the information is collected where it actually exists — recurring rules in the profile, the initiator's own at initiation, and everyone else's through the third control on the proposal card (§3.2).

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
| `ParticipantMeetingContext` | **Sparse** — a row exists only when someone amends. Per user and meeting: origin override, mobility windows with mode (`car`/`transit`/`walk`), free-text note, timestamp. Each `MatchRun` records which rows it saw, so the timeline can say *why* a re-weighing happened (§3.2, §5.7) |
| `ConflictDismissal` | Per user and unordered meeting pair: this user has said the two do not clash. Without it the warning returns on every poll (§5.7) |

`PreferenceProfile` additionally carries `tolerance_km` and the recurring mobility rules of §5.1; `Meeting` additionally carries an optional free-text `occasion` set at initiation, which is one of the Context Resolver's inputs.

### 6.3 External Services

| Service | Role | Cost | Note |
|---|---|---|---|
| Google OAuth + Calendar | Sign-in and availability | Free at this scale | Scope `calendar.freebusy` — free/busy intervals only. See the access model below |
| **Google Places** | Real restaurant data — the v1 source | Per-SKU free monthly thresholds — see below | Supplies coordinates (§5.4), **opening hours and business status**. **No table availability** — that is a reservations platform, out of scope (§11). Authenticates by **API key**, not by user OAuth |
| Easy (easy.co.il) | Candidate enrichment source — **blocked** | Unknown | Israeli local search with restaurant filters that map unusually well to our constraints: kosher type, vegetarian, vegan, child-friendly, atmosphere. **No public API documentation found** as of Aug 2026. Ask them directly; do not scrape. Only integrate if they grant access — see §13.1 |
| PostgreSQL | Persistence | Free tier sufficient | Managed Postgres on Vercel or an equivalent provider |
| **Resend** | Invitations and notifications | 3,000/month and 100/day on the free tier — permanent, not a trial | Sends from a **dedicated project address**, never a participant's mailbox. Needs a verified sending domain — see below |

#### Why not the Gmail API

The obvious-looking move — the project already authenticates with Google, so send the mail with Google too — does not survive contact with what `gmail.send` actually is.

**It sends *on behalf of a user*.** Mail would leave from a participant's own Gmail address, land in their Sent folder and count against their personal quota. But the notifications in §5.5 have **no human sender**: the agent produced the proposal, and there is no participant whose account should be mailing the others every time it does. Picking one arbitrarily would mean the initiator's private address sending system mail to her friends.

**And `gmail.send` is a sensitive scope.** Not restricted — it needs no paid security assessment — but sensitive is precisely the tier this project just left. The calendar scope was narrowed to `calendar.freebusy` so the app could stay non-sensitive, publish In production, and escape the 7-day refresh-token expiry. Adding one sensitive scope for email would put it back in the verification queue, or back in Testing with weekly re-consent for the whole team. The entire OAuth position would be traded away for something a transactional provider does better and for free.

A provider also gives the personal touch that Gmail appears to offer, without any of it:

```
From:      "Dana via SquadLock" <notify@…>
Reply-To:  dana@…
```

> ⚠️ **A free tier needs a verified sending domain.** Development can use the provider's test sender, but a real demo cannot. A domain is roughly $10–15/year and is **the only item in this project that costs actual money** — buy it early, because DNS verification has a waiting period that does not care about your milestone dates.
>
> ⚠️ Also note that SendGrid, the other obvious candidate, **no longer has a free tier** — it is a 60-day trial. Verify any provider's current terms rather than inheriting them from memory; this document has already been wrong once that way about the Places credit.

**Two-tier caching, keyed by neighbourhood.** The search query is a property of a *neighbourhood*, not of a meeting: "Dana's neighbourhood plus radius R" is the same query for every meeting, in every group she belongs to, forever. Keying the cache on rounded coordinates rather than on a meeting id therefore makes it shared across meetings and users — and the rounding is already there, because §5.4 stores homes at neighbourhood granularity for privacy. Cycles 2 and 3 of a meeting are pure cache hits.

Opening hours are cached **separately and briefly**, and fetched only for the shortlist. Hours change for holidays and closures, and proposing a restaurant that is shut on the night is a real failure; detailed fields also sit in a higher price tier than basic ones, so fetching them for twenty candidates rather than three hundred is what makes the funnel pay for itself twice.

#### Access model — two different mechanisms

The two Google integrations are often spoken of as one thing. They are not, and conflating them is what produces the wrong plan.

| | Google Calendar | Google Places |
|---|---|---|
| Authenticates as | **the user**, via OAuth consent | **the project**, via an API key |
| Needs user permission | Yes — a consent screen per participant | No |
| Subject to app verification | Depends entirely on the scope | Not applicable |
| Free allowance | API quota, free at this scale | Per-SKU monthly thresholds |

#### Calendar: the scope choice decides whether verification applies

Google classifies OAuth scopes as non-sensitive, sensitive, or restricted, and **only sensitive and restricted scopes pull an app into the verification process.** Reading the events stored in a calendar is Google's own example of a sensitive scope, so `calendar.readonly` and `calendar.events.readonly` are sensitive. `calendar.freebusy` — "view your availability in your calendars" — returns busy intervals with no event content, and appears to be **non-sensitive**.

That distinction decides the whole OAuth plan, because of what Testing status costs:

> ⚠️ **An app in "Testing" publishing status has its refresh tokens expired by Google after 7 days.** This is by design and it is not configurable. Over an 8-week project it means every team member re-consenting weekly, and it can break a demo on the day. Testing status also caps the app at 100 test users.

Earlier drafts of this document treated Testing mode as a free pass for v1. It is not — it is a 7-day timer. If `calendar.freebusy` is confirmed non-sensitive, the app can be published **In production** with no verification, no test-user cap, and refresh tokens that do not expire on a schedule.

**Before Week 2, confirm the classification in the Cloud Console.** Adding a scope to the consent screen displays its classification directly; that check is definitive and takes minutes. The plan branches on the answer:

- **Non-sensitive** → publish In production immediately. The 7-day expiry, the test-user cap and the verification queue all disappear, and token refresh becomes ordinary housekeeping rather than a weekly outage.
- **Sensitive** → stay in Testing, accept weekly re-consent for the team, and make sure a fresh consent happens shortly before any demo.

Either way, request the minimum scope now. Broadening later is easy; narrowing after users have consented is not. Note that the habit inference deferred in §5.2 would need event content and therefore a sensitive scope — a reason to keep it out of v1 beyond the effort it costs.

#### Places: the $200 credit no longer exists

> ⚠️ **Correction against earlier drafts.** The flat $200 monthly credit was **replaced on 1 March 2025** with a free monthly usage threshold per SKU tier. Any plan resting on "the $200 covers development and the demo" is resting on something that was withdrawn.

| Tier | Free events per month | Fields relevant to us |
|---|---|---|
| Essentials | 10,000 | `location` |
| Pro | 5,000 | `businessStatus` |
| **Enterprise** | **1,000** | `regularOpeningHours`, `currentOpeningHours`, `rating`, `priceLevel` |

**A request is billed at the highest tier any requested field belongs to.** This has a direct consequence for the funnel in §5.4: **opening hours and rating are both Enterprise fields**, and the funnel uses rating to fill half the shortlist and opening hours to gate `(venue, time)` pairs. Requesting either one anywhere makes that whole request an Enterprise request, against the smallest allowance of the three.

This does not break the design, but it does change the caching from a nice-to-have into the thing that keeps the project inside the free tier:

- **Never put an Enterprise field in the wide search field mask.** Search on Essentials/Pro fields; fetch Enterprise fields only for the ~20 candidates that reach the shortlist.
- The neighbourhood-keyed search cache and the short-lived hours cache are what turn a per-meeting cost into a near-zero marginal one.
- ⚠️ **Confirm Nearby Search's tier as a function of its field mask before building**, and measure real call counts against the 1,000 Enterprise events during Week 2 rather than assuming.

### 6.4 Language Models and Cost

> ⚠️ **Correction against earlier drafts:** Claude 3.5 Sonnet and Claude 3.5 Haiku have been **retired** (28 Oct 2025 and 19 Feb 2026). Calls to them return 404.

| Model | ID | Input / Output per 1M tokens | Context |
|---|---|---|---|
| Claude Opus 5 | `claude-opus-5` | $5 / $25 | 1M |
| Claude Sonnet 5 | `claude-sonnet-5` | $3 / $15 (promo: $2 / $10 through 2026-08-31) | 1M |
| Claude Haiku 4.5 | `claude-haiku-4-5` | $1 / $5 | 200K |

**Mapping:** `claude-haiku-4-5` for development and repeated runs · `claude-sonnet-5` for the demo and real use · `claude-opus-5` only if evaluation proves a gap.

The **Context Resolver** (§4) and the **Constraint Updater** are twins: both are small extraction tasks turning free text into a validated typed object, both sit on `claude-haiku-4-5` from the start, and both share the same prompt, schema, and validation conventions — which is why one person builds both. ⚠️ Neither prompt is long enough to reach Haiku 4.5's 4,096-token minimum cacheable prefix, so **do not try to cache them**: below the minimum, caching fails silently and without an error.

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
- **At least one closed-on-the-night trap:** the best venue is shut at the proposed time (§5.7).
- **At least one mobility-window trap:** a participant has no car for part of the evening, so a far venue is wrong early and fine late — the correct answer is a *(venue, time)* pair, not a venue.
- **At least one semantic-geography trap:** two neighbourhoods that are effectively one area, or two that are close in a straight line but separated by a barrier. This is what the Context Resolver is for, and it is the scenario that measures whether it earns its place.
- Re-run on every change to the engine.

**Run the suite with the Context Resolver on and off.** It has a full fallback to the deterministic baseline (§4.3), so both configurations are always runnable, and the delta between them is the evidence for the decision rather than an argument about it.

**Metrics per run:** scenario pass rate · dollar cost per decision · wall-clock time · cycles used · hard-constraint violations (must be zero).

**Unit tests** for the deterministic layer: leximin scoring, the hard-constraint filter, the burden gate, availability and opening-hour intersection, search-area derivation, the conflict overlap rule. No LLM required to test these.

**The LLM layers are unit-tested at their guard rails, not at the model.** The Context Resolver's clamp and validation are tested with **fabricated adversarial outputs** — a coordinate in the sea, a 500 km radius, a negative tolerance, a detour factor below 1 — plus the invariant (the widened union always contains the baseline) and the fallback (a failed call produces exactly the pre-Resolver behaviour). The model itself is measured by eval scenarios. Nothing in the deterministic column depends on a model, and nothing in the eval column depends on arithmetic — that separation is what makes a failing scenario attributable to a stage.

Two further **validation** checks, in the same family as the per-participant justification rule:
- An option that omits any confirmed participant fails (§4.2 risk).
- **A re-weighing that re-proposes the option just rejected fails** — that is not a matching error, it is a signal that the Constraint Updater did not capture the objection.

The eval set does not change with the §4.2 architecture — it describes correct answers, not how they are reached. That is exactly why it was written first, and it is what would make an eventual multi-agent comparison a fair one.

---

## 10. Boundaries

**Always:**
- Persist every matching run in full — inputs, ranked options, and the choice.
- Enforce all three caps (§3.1).
- Filter hard constraints in code, and re-check the agent's answer against them.
- Use structured outputs for every agent response.
- Run the conflict check across **all** of a user's groups, never within one.
- Let the model set parameters; never let it do arithmetic, sort a candidate set, or return a distance (§4.1f).
- Keep model influence on retrieval **widening-only**; narrowing belongs in scoring (§4.1g).
- Give any model-supplied number a clamp, a sanity check, and a fallback to the deterministic path.
- Write a conflict cancellation as one transaction across both meetings.
- Run the eval set before merging a change to the engine.

**Ask first:**
- Changing the database schema.
- Adding a dependency or an external service.
- Moving to a more expensive model.
- Anything beyond the v1 scope in §11.

**Never:**
- Commit API keys, secrets, or OAuth tokens.
- Request a broader calendar scope than `calendar.freebusy` while v1 needs only availability (§5.2, §6.3).
- Put an Enterprise-tier Places field in a wide search request rather than a shortlist detail request (§6.3).
- Run a rejection loop without the cycle cap.
- Rely on the agent alone to respect a hard constraint.
- Show more than one proposal at a time.
- Tell a participant what a proposal costs them relative to an alternative they did not get (§5.6).
- Charge a cycle for an amendment that corrects the input rather than rejecting the output (§3.2).
- Cancel a meeting silently, or delete one instead of returning it to weighing.
- Build an expansion domain before one slice runs end to end.

---

## 11. Explicitly Out of Scope for v1

Apple Calendar and Outlook · restaurant reservations · day-before reminders · web push notifications · any activity type other than restaurants · vector DB · habit inference from calendar history · all expansion domains (B2B, travel, community, study) · native mobile app · **travel-time routing** (v1 uses straight-line distance — §5.4) · **the Easy integration** unless they grant API access in time (§13.1) · **personal agents per participant and multi-round negotiation** as the v1 architecture (superseded — §4.2; the comparison implementation remains in scope as post-Milestone-2 work, for the report) · **free-form conversation in the group** (§5.6 — the feed is a structured surface, not a chat) · **showing the user more than one proposal at a time** (§3.1) · **a separate participation-confirmation step** (§3.2 absorbs it) · **table availability and restaurant reservations** — not obtainable from the venue provider, and a reservations platform is a separate integration (§6.3) · **weather** — forecasts for a meeting proposed days ahead are unreliable and are never refreshed on the night, so the data would be wrong precisely when it mattered; an initiator who knows it will rain can say so in the occasion note, which the Context Resolver already reads · **a live push connection for the feed** (§5.6 — adaptive polling instead) · **the comparative cost line** in a proposal (§5.6).

---

## 12. Success Criteria

1. A friend receives an emailed link, signs in with Google, and completes a profile in under a minute.
2. A group of 3+ can create a proposal with any subset of date, time, and venue specified.
3. The system returns an **existing** restaurant — open at the proposed time and not closed down — that satisfies every participant's hard constraints, fits every confirmed participant's calendar, and is reachable for all of them, with no participant left carrying a travel burden far worse than the rest.
4. A free-text rejection produces a materially different next proposal that visibly addresses the stated reason.
5. The eval set passes on ≥ 80% of scenarios, including the rejection-loop scenarios, with **zero hard-constraint violations** across all of them.
6. A matching run completes in ≤ 20 seconds, with visible progress throughout.
7. Every decision shows each participant why it works **for them**, in wording written for them specifically. It does not tell them what it cost them relative to an option they did not get (§5.6).
8. A user with meetings in two groups on the same evening is warned before approving either, and approving one repairs the other rather than dropping it.
9. The whole flow runs on a phone, and a stranger completes it without help.

> Targets 5 and 6 are proposals to validate against the first working engine, not fixed requirements. The 20-second figure replaces the 90 seconds the superseded multi-agent design needed (§4.2) — if the real number lands far above it, that is a finding about the architecture, not just a slow run.

---

## 13. Open Questions

| # | Question | Status |
|---|---|---|
| 1 | Can we get API access to Easy (easy.co.il)? | **Blocked on them.** Email them in Week 1 — a one-hour task with a potentially large payoff, and the answer arrives on their schedule, not ours. Build on Google Places regardless; treat Easy as enrichment that may never land |
| 2 | What is the real worst-case duration of a matching run, and does it fit the Vercel function timeout? | Open — measure it in Week 1 against the chosen plan's limit and write the number down. Streaming inside a request is the expected answer (§4.1e) |
| 3 | What burden value should the gate `T` sit at? | Open — a number, not a design. Start around 2.0 (twice a person's stated comfortable distance) and tune against eval quality. Too tight starves the pool, which then triggers expansion (§5.4) |
| 4 | What radius, and how many expansion steps? | Open — tune against your own real addresses. Note that expansion adds query centres rather than enlarging the radius (§5.4) |
| 5 | Is 4 hours the right conflict window, and 90 seconds the right amendment batching window? | Open — both are numbers to tune. The conflict window errs tight on purpose, because a false positive destroys a meeting (§5.7) |

**Resolved during specification:****Resolved during specification:**

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
- ~~Distance or travel time?~~ → **Straight-line distance for v1**, corrected by a Resolver-supplied detour factor (§5.4).
- ~~How much of the fairness trade-off is deterministic scoring versus the agent's judgement?~~ → **The gate is deterministic and binding; above it, fairness is advice.** Every candidate that survives the burden gate is valid, and choosing among valid options is the agent's job (§5.4, §4.1f).
- ~~How many candidates enter the matching run?~~ → **20–24**, filled from two parallel ranked lists (§5.4).
- ~~How does the feed refresh — polling or a live connection?~~ → **Adaptive polling**, plus the streaming the initiator's own request already provides (§5.6).
- ~~Does a rejection always trigger a new run, or first try the unused ranks 2–3?~~ → **Always a new run** — the visible response to the objection *is* the product (§12.4). The unused ranks stay as candidates in that run and as material for the timeline, but they are never served as the answer, and the option just rejected may not return (§9).
- ~~How much time overlap counts as a conflict?~~ → **Same day, less than 4 hours apart** (§5.7).
- ~~What does the agent do about fairness scores — advice or binding?~~ → **Advice.** See the gate above.
- ~~Should the model compute the search area and the distances?~~ → **No — it supplies parameters and code runs the function** (§4.3).
- ~~Weather?~~ → **Out of scope** (§11).
- ~~Which email provider, and could Gmail send the mail?~~ → **Resend, and no.** `gmail.send` sends on behalf of a *user*, but these notifications have no human sender; and it is a sensitive scope, which would undo the OAuth position §6.3 was narrowed to protect.

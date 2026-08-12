# Confirmed Intent — SquadLock

Produced by an interview on 2026-08-06 and confirmed explicitly. **Revised and re-confirmed on 2026-08-12** — the architecture and the interface both changed deliberately; see the decisions below. This is the statement of what we are building and why. The [spec](../spec.md) and the [work plan](../../tasks/plan.md) are downstream of it — if they ever contradict this document, this document wins until it is deliberately revised.

## Intent

**Outcome** — A web app the team actually opens when deciding where to meet. Each group is a feed of meeting cards. Someone presses "I want to arrange a get-together", one agent weighs everybody's profiles together and decides, and a single proposal appears in the feed — each person seeing why it suits them and what it costs them. Whoever rejects says whether they can't come at all or the plan is wrong, and the reason returns to the agent as an updated constraint.

**User** — The team and their friends. Groups of 3–6 people, and the same person belongs to several groups at once. Not organizations, not work teams.

**Why now** — Capstone project: 3 students, 3 months, currently on break. The real goal is not the submission — it is that something usable remains afterward.

**Success** — A friend gets a link, signs in with Google, sets up a profile in under a minute, and receives a real restaurant proposal that respects everyone's hard constraints and fits everyone's calendar. Rejects it in free text → gets a different proposal that accounts for what they wrote. All on a phone, with nobody from the team standing next to them explaining.

**Constraint** — TypeScript end to end, Next.js + Vercel, a PWA that opens on a phone. Must run smoothly in a live demo.

**Out of scope (v1)** — Apple Calendar and Outlook · restaurant reservations · day-before reminders · push notifications (start with in-app + email) · any activity type other than restaurants · vector DB · all expansion domains · native app · personal agents per participant (decision 1) · free-form conversation in the group (decision 5) · showing more than one proposal at a time (decision 6).

## Architectural decisions

1. **One agent decides, not one agent per person.** *(Revised 2026-08-12.)* A single Group Matching Agent receives every member's hard constraints, soft preferences, location, and availability **together**, and returns a ranked set of options. The earlier design — a personal agent per participant negotiating over capped rounds — is superseded. Everyone's profiles fit in one context, so splitting them only made each agent reason from a partial view, at higher cost and latency. Full reasoning in [spec §4.2](../spec.md).
2. **The agent decides without humans.** Humans enter only to respond to the finished proposal.
3. **Free-text rejection → updated constraint → new cycle.** The most novel part of the project and the center of the report. After decision 1 it is not merely the most novel part — it is the differentiator.
4. **The decision must explain itself per person.** With no personal agent visibly arguing on your behalf, the per-participant justification — including an honest line on what the choice costs you — is what makes the result feel accountable instead of arbitrary. A product requirement, not a debug view.

## Product decisions *(added 2026-08-12)*

5. **The group is a structured feed, not a chat.** It looks like a conversation and reads like one, but only the agent posts and members respond through defined controls. An open chat would demand real-time messaging and an agent judging when to speak — neither is needed for the product to work.
6. **One proposal at a time.** The agent ranks three internally and shows the best. Three on screen is a poll, and a poll is the thing being replaced.
7. **Two rejections, not one.** "I can't make it" removes you from this meeting only and does not spend a cycle. "Something here doesn't work for me" keeps you in and spends one of three. A single button would conflate them and waste re-weighings on people who were never coming.
8. **Several meetings run in parallel, capped at three per group, sorted by date.** Declining is scoped to one meeting and never touches group membership — which is what makes separate groups unnecessary.
9. **Conflicts are detected across every group a user belongs to**, not within one. Approving one meeting cancels the conflicting one automatically, after a warning shown directly above the approve button. **A cancelled meeting returns to weighing rather than being deleted** — the others may already have approved it, so cancellation is something the system repairs, not merely announces.

## One-way doors — done from day one

Cheap now, impossible or expensive to reverse later:

1. Record every matching run to the database — the shortlist in, the ranked options out, what was chosen and why.
2. Secrets never enter the repo.
3. Request the minimum calendar OAuth scope (read-only).
4. Structured output for every agent response.
5. Hard constraints enforced in code, never left to the model's goodwill.
6. Index meetings by **user and time**, not only by group. The cross-group conflict query (decision 9) is impossible to add later without a migration touching every meeting.

# Failure and Unavailability — a system-wide reference

Every point where SquadLock depends on something outside its own code — Google, the LLM, the database, email delivery, the hosting platform's own limits — and what is supposed to happen when that thing is slow, wrong, or simply not there. This is not new architecture. It **collects** what [spec.md](spec.md), [decisions/design-decisions.md](decisions/design-decisions.md) and [tasks/todo.md](../tasks/todo.md) already commit to, and separates that from the handful of failure modes nobody has actually decided yet — so the second group doesn't get invented ad hoc by whoever happens to write that code first.

[onboarding-flow.md §7](onboarding-flow.md) covers the onboarding-specific cases (a declined consent screen, an expired invite) in full; this document is everything else, plus the cross-cutting ones.

---

## 1. Map of dependencies

| Dependency | Used by | What can go wrong |
|---|---|---|
| Google OAuth (sign-in) | Onboarding, every session | User declines, Google unreachable, Testing-mode cap/expiry — see onboarding-flow.md §7 |
| Google Calendar (`freebusy`) | Availability computation (B6), every matching run | Call fails or times out, access revoked after the fact, empty calendar |
| Google Places | Candidate funnel (B7) | Call fails or times out, monthly quota exhausted, search area yields nothing |
| Anthropic API — **Context Resolver** | Pre-search parameters (A12) | Timeout, malformed output, outage |
| Anthropic API — **Group Matching Agent** | The decision itself (A4) | Timeout, malformed/invalid schema output, outage |
| Anthropic API — **Constraint Updater** | Rejection parsing (A7) | Timeout, malformed output, outage |
| PostgreSQL | Everything | Unreachable, write fails mid-transaction |
| Resend | Invitations and notifications (B8) | Send fails, bounces, domain misconfigured |
| Vercel function timeout | Any matching run | Exceeded despite the Week 1 measurement (F2) |
| Client network | Feed polling, saving a form | Connection drops mid-request |

---

## 2. Already decided — what to build, and where it's written down

Everything in this section is a real decision already recorded elsewhere. No product judgement is needed here, only implementation.

| Situation | Decided behaviour | Where |
|---|---|---|
| Context Resolver call fails, times out, or returns something that doesn't pass validation | **Falls back to exactly the pre-Resolver deterministic path.** Every model-supplied number is clamped to a range and checked against a sanity bounding box first. The Resolver can only ever *widen* the search, never narrow it — so its worst failure is one extra Places query, never a starved candidate set | §4.1g, §4.3, A13 |
| No `(venue, time)` pair survives the intersection of calendar availability, opening hours, and mobility windows | The meeting goes to **`stuck`** — the best option found is shown with an explanation, not a bad proposal forced through | Task B6 |
| A meeting is cancelled by a conflict | **One transaction across both meetings.** The cancelled meeting **returns to weighing**, never deleted, with the approving user marked `cant_make_it`. A test explicitly requires that a mid-write failure leaves neither meeting half-updated | §5.7, B5c |
| A meeting exhausts its 3 reject-and-rematch cycles | Enters `stuck`: best option shown, explanation given, group settles it manually. It gets its own notification email specifically so it doesn't go quiet | §3.1, §5.5 |
| The agent's chosen option turns out to violate a hard constraint | Caught by the post-check (A2) before anything reaches a user — the agent never gets the last word on an allergy or a kosher requirement | §4.1b |
| Google OAuth Testing-mode weekly token expiry | Structurally avoided, not handled at runtime: narrow the scope to `calendar.freebusy` so the app can likely publish **In production** instead of staying in Testing. If it can't, this becomes a real weekly-refresh problem to plan around, not a one-off bug | §6.3, onboarding-flow.md §7 |
| Google Places cost blowing past the free tier | Prevented by design — two-tier caching keyed by neighbourhood, and Enterprise-tier fields (hours, rating) requested only for the ~20-item shortlist, never the wide search | §6.3, B7 |

---

## 3. Gaps, closed — proposed defaults

These were genuine gaps with no recorded decision. Below is a concrete recommendation for each, in the same style as [decisions/design-decisions.md](decisions/design-decisions.md) — **proposed**, not yet stamped by the three of you the way D1–D12 were. Treat this section the way you'd treat a draft PR: cheap to overturn in the design review, expensive to leave silently unwritten until someone hits it in the wild.

**G1 — The Group Matching Agent itself fails** (timeout, invalid output on retry, outage).

**Recommendation:** up to **2 automatic retries inside the same streamed request** — the request is already open and streaming per §4.1e, so this costs nothing new. If all attempts still fail, show a distinct **"couldn't complete this match"** state with a manual retry action for the initiator. **Not** `stuck` — that specifically means the group's 3 cycles ran out, and this is not that. **Not** an automatic background retry loop either — that needs new infrastructure, against the no-cron/no-background-job stance already taken for the amendment window (§3.2) and the feed refresh (§5.6). **A technical failure never spends a cycle** — the exact reasoning §3.2 already uses for the amendment cap: charging the group for something that was never their indecision is the same category error the two-rejection split exists to fix. Log the failure server-side; nothing here should read to a group like a flaw in the product.

**G2 — The candidate funnel produces an empty shortlist** even after the burden gate and every expansion step.

**Recommendation:** skip the agent call entirely — there is nothing to send it — and go straight to a state with the same UI treatment as `stuck` (an explanation, no proposal, the group decides manually) but **distinct wording and no cycle charge**. Calling it `stuck` would be misleading on a group's very first attempt, since `stuck` implies 3 tries were spent and none were. Something like *"we couldn't find anywhere that works for everyone — try widening a preference or your travel tolerance"* names the actual lever the group can pull, which `stuck`'s wording does not.

**G3 — Google Places' free monthly quota is exhausted** despite the caching design.

**Recommendation:** do **not** silently drop Enterprise-tier fields (opening hours, rating) to keep runs going — that quietly weakens success criterion §12.3's "open at the proposed time" guarantee, and a silently weakened safety guarantee is worse than a paused feature. Instead: block new matching runs, show the same "couldn't complete this match" state as G1, and alert the team directly (log or a simple notification channel), not the group. At this project's real scale — a handful of friend groups during a capstone — this should be very unlikely to actually trigger; treat it as a smoke alarm, not a feature to build out.

**G4 — A real Resend notification fails to send** (bounce, API error), not the test sender.

**Recommendation:** the invitation email is the one case that's load-bearing — per §12.1 it's the *only* way someone joins at all — so its failure should surface to the inviter in the UI (a plain *"delivery to X failed — you can share the link directly"* indicator) so a human can route around it. The other four triggers in §5.5's table (proposal waiting, confirmed, returned-to-weighing, stuck) are **not** the sole channel for anything — the in-app feed already shows all of it on next open, by design (§5.6). So for those: one automatic retry of the Resend API call, then log and move on. Building a delivery-status webhook queue for v1 is new infrastructure for a channel that was already explicitly designed to be non-critical everywhere except the invite.

**G5 — The Vercel function timeout is exceeded** in production, despite the Week 1 measurement (spec §13 #2).

**Recommendation:** this collapses into G1 rather than needing its own answer — from the client's perspective, a platform-killed function and a failed API call are indistinguishable, and the client is only ever polling (§5.6), so it doesn't know or care why the previous attempt didn't finish. Apply G1's handling unchanged: the retry budget and the "never charge a cycle for a technical failure" rule cover this case as a special instance, not a new one.

**G6 — PostgreSQL is unreachable.**

**Recommendation:** the boring, generic case, and it should stay that way — resist building custom retry/circuit-breaker machinery for v1. Reads: the existing poll loop (§5.6) already retries on its own cadence; show a plain *"can't reach the server — retrying"* banner only after **2 consecutive** failed polls, so one blip doesn't flash an error. Writes: single-row writes get atomicity from Postgres itself for free; the one place with a real multi-row write (conflict cancellation) is already required to be transactional (B5c) — that requirement already generalizes to any future multi-row write, so it doesn't need a separate rule here.

---

## 4. The pattern this section keeps repeating

Two rules cover all six recommendations above, and they're the same two rules section 2's already-decided cases follow: **a run never ends up half-finished with no visible state** (it becomes a named state — `stuck`, the G2 empty-state, or the G1/G5 "couldn't complete" state — never a silent hang), and **a technical failure is never charged to the group's cycle cap**, because the cap exists to bound a group's own indecision (§3.1), not to absorb the system's faults. Where new infrastructure would be needed to do better (a webhook queue for G4, a background retry loop for G1), the recommendation deliberately stays inside what §3.2 and §5.6 already built — the poll loop and the one open streamed request — rather than adding a new mechanism for a case that, at this project's real scale, should be rare.

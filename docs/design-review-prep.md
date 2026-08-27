# Design Review — preparation

Everything here is already recorded in [spec.md](spec.md), [plan.md](../tasks/plan.md) and [decisions/design-decisions.md](decisions/design-decisions.md). This page exists so the three of you arrive with the same answers, and so the hard questions are ones you have already had rather than ones you meet in the room.

---

## 1. The project in one paragraph

A single **Group Matching Agent** receives every participant's profile, calendar and location together, and returns a date, a time and a venue with a per-person justification. Everything computable is computed in code before the agent sees anything: the search area, the hard-constraint filter, the distance fairness scores, the candidate shortlist. When someone rejects a proposal in free text, that text is parsed into a **structured constraint** that drives the next matching cycle, up to a cap of three.

Two sentences are the whole design: **code narrows only on what is true or false; the model decides among what is valid.**

---

## 2. The question everything orbits: "isn't this just a prompt?"

Expect this in some form. It is the single most likely challenge, because the architecture is one LLM call. **There are three answers and you should be able to give all three without notes.**

**One — the rejection loop.** "This place isn't to my taste" is not a button. It becomes a structured constraint update that visibly changes the next proposal. That is the novel mechanism, it is measured by two dedicated eval scenarios, and if it fails that is still a reportable finding. _(§2.2.1, §12.4)_

**Two — the deterministic layer.** Leximin fairness scoring, the hard-constraint filter with its post-check, the candidate funnel with its gate, cross-group conflict detection, and the `(venue, time)` intersection. None of it is a prompt. The model is not trusted with anything that has a correct answer. _(§4, §4.1b, §4.1f)_

**Three — two architecture decisions made with evidence rather than taste.** §4.2 dropped a multi-agent design; §4.3 put an LLM in the geography layer but only as parameters. Both are written up with what they cost, and both have a planned measurement — A11 and A14 — rather than an assertion.

---

## 3. Questions to expect, by area

### A. Architecture

**"Why one agent? Multi-agent is the more interesting system."**
Decomposition pays when the context does not fit in one window or when there is real parallelism. Neither applies: six profiles, ~20 venues and a set of calendar openings fit comfortably in one context. Splitting them means each agent reasons from a partial view and communicates through a lossy channel, which costs decision quality rather than buying it — and it is roughly an order of magnitude more expensive and too slow to run inside a request. We wrote the eval set architecture-independently _precisely_ so this could be measured (#20). _(§4.2)_

**"You gave up the most novel part of your own proposal."**
Yes, and deliberately — the write-up says so. What went with it was the idea that a personal agent _represents_ you, which is a real product property, not just theatre. It was traded for a system that decides better and ships. That trade is itself the reportable content. _(§4.2)_

**"The Context Resolver reintroduces exactly what you said not to do."**
No. It supplies **parameters**; code runs the function. The model never performs arithmetic, never sorts a candidate set, never returns a distance. And it may only _widen_ what gets retrieved. _(§4.1f, §4.1g, §4.3)_

### B. The boundary between model and code

**"Why not let the model compute the distances? It would handle the messy cases."**
Three reasons. It does not compute, it estimates — 320 haversine calculations returned confidently and wrong by tens of percent, in the right format, with no error signal. It approximates a sort rather than performing one, which does not weaken the minimise-the-worst-burden guarantee, it **dissolves** it — a guarantee only means something if every candidate was actually examined. And it would replace unit tests with eval scenarios, which confounds "chose badly" with "computed badly".

**"Then how do you know the parameters it _does_ supply are any good?"**
We do not assert it — #54 measures it, by running the whole eval set with the Resolver on and off. The fallback is what makes that possible: both configurations are always runnable on the same scenarios.

**"What if it hallucinates a neighbourhood or a coordinate?"**
Four guards: every number clamped to a range, every region centre checked against a bounding box derived from the participants' own coordinates, the widening invariant enforced, and a full fallback to the deterministic path on any failure. **The worst case of a bad model output is one extra API query, never a wrong answer.** _(#53)_

### C. Fairness

**"Why not just minimise the average distance?"**
Averaging lets a group repeatedly choose venues next door to three people and far from the fourth. That person stops showing up. The system optimises the **worst** burden instead. _(§5.4)_

**"Then why not plain maximin? Leximin is more complex."**
Plain maximin is degenerate. Two candidates with the same worst-off participant are _exactly equivalent_ to it, even when one is far better for everyone else — so ties get broken downstream by star rating and the fairness silently disappears. Leximin continues to the second-worst, then the third. It is the standard refinement of maximin in social choice theory and it costs about five lines. _(§5.4)_

**"Why not a weighted score of fairness and rating?"**
It needs an exchange rate between kilometres and stars, which does not exist, and a weight is a magic number. Worse, a weighted sum lets an excellent rating _buy its way past_ unfairness — the exact thing the fairness layer exists to prevent. So fairness **gates**, and above the gate the shortlist is filled from two parallel ranked lists. _(§5.4)_

### D. The rejection loop

**"Isn't free text → structured constraint just extraction? Where is the research?"**
The extraction is the easy half. The question being measured is whether an extracted constraint produces a next proposal that is **materially different and visibly responsive** — §12.4, with two dedicated eval scenarios. A negative result there is a finding, not a failure.

**"How do you know the constraint actually captured what the person meant?"**
Two checks. The option just rejected **may not be re-proposed** — if it is, that is a validation failure signalling the Constraint Updater missed the objection. And the two eval scenarios carry an expected follow-up proposal, not just an expected outcome. _(§9)_

**"What if it never converges?"**
Cap of three, then the meeting enters `stuck`: the best option found, an explanation of why it stopped, and the group settles it. It does not silently vanish from the feed. _(§3.1, #45)_

### E. Evaluation

**"Who decided the correct answers? Isn't that circular?"**
Three people agree on each answer independently, **before the engine exists**. Disagreement means the scenario is underspecified, which is the point of writing them in week 1. The set is also architecture-independent — it describes correct answers, not how they are reached, which is what makes the #20 comparison fair. _(§9)_

**"Eight to twelve scenarios is very small."**
Agreed — see §4 below. It is a hand-verified trap suite, not a statistical benchmark, and the claim is scoped to match.

### F. Data, privacy, and the social failure mode

**"You are storing the home addresses of a friend group."**
Neighbourhood granularity, never a street address, with the coarseness visible in the UI. Calendar access is read-only and the app stays in Testing mode. _(§5.4, §6.3)_

**"Your system cancels a meeting other people already agreed to."**
This is the worst failure the product can have, and it is treated as such. The cancelled meeting **returns to weighing rather than being deleted**, so the others get a new time instead of a cancellation notice; the write is one transaction across both meetings; the warning appears above the approve button before the press; and a false positive can be dismissed with "these don't clash". _(§5.7)_

### G. Product decisions that can look arbitrary

**"Why not tell each person what the choice cost them? Transparency is better."**
Naming a cost manufactures a grievance that did not exist — the person would not have noticed the extra fifteen minutes until we told them they drew the short straw. Naming a **constraint** is not the same as naming a **comparison**. The trade-off is still computed and persisted for the timeline and the report; it is simply not shown to the person who bore it. _(§5.6)_

**"Why show one proposal instead of the ranked three?"**
Three on screen is a poll, and a poll is the thing this product replaces. _(§3.1)_

**"Why polling instead of a live connection?"**
A held-open connection bills by duration on a serverless host, needs a pub/sub service to fan one user's action out to others, and brings reconnection and mobile-backgrounding work — for a surface where seconds of staleness are acceptable by design. The initiator already gets live progress free, from her own streaming request. _(§5.6)_

**"Why two rejection buttons, and now a third control?"**
One button carried two incompatible meanings the agent cannot act on: "I'm out" and "the proposal is wrong". The third is a correction to the **input** rather than a rejection of the **output** — "I have no car tonight" is information the system lacked. Only the middle one spends a cycle. _(§3.2)_

### H. Schedule

**"Is eight weeks realistic for all of this?"**
The honest answer, and the fallback, are in §4 below. Do not improvise this one.

---

## 4. Where we are genuinely weak

Have these ready. A reviewer who finds a weakness you have already named reads it as rigour; the same weakness found on your behalf reads as an oversight.

**1. Fairness is advisory above the gate, with nothing checking it.**
Below the gate a venue is dropped in code. Above it, the agent may pick a better-rated, less fair option and nothing catches it — so the leximin ranking we built can be quietly overridden.
_The answer:_ the gate is where fairness is _enforced_; above it every candidate is valid, and choosing among valid options is the agent's job. This is the §4.1f principle applied consistently rather than an oversight.
_The fallback if pushed:_ the cheap fix is already designed — require the option's trade-off field to name the fairness cost whenever the agent does not pick the leximin leader. The field is already mandatory and already persisted; it would be one validation rule. Offer this rather than defending the gap.

**2. The candidate universe is ranked by the venue provider, not by us.**
A local search API returns a capped number of results per query. "All venues in the area" was never achievable — an earlier draft of the spec claimed it and has been corrected. So the shortlist is drawn from a pool the provider pre-selected by its own relevance ordering, and we cannot see or control that bias.
_The answer:_ it is documented rather than hidden, and it is mitigated by querying **per neighbourhood** rather than once over a bounding box, which is what preserves coverage near each participant. It remains a real limitation on any claim about optimality.

**3. Straight-line distance with an estimated detour factor is not validated against real travel time.**
Three kilometres can be ten minutes or forty, and the correction factor is supplied by a language model, not measured.
_The answer:_ it is an explicit v1 trade-off with routing documented as the upgrade path, and the detour factor sits honestly between the two. It is also measurable — #54 shows whether it helps at all.

**4. The eval set is small and we wrote it ourselves.**
_The answer:_ it is a hand-verified trap suite with specific failure modes, agreed by three people before the engine existed. The claim is "zero hard-constraint violations and ≥80% on scenarios we agreed in advance" — not a generalisation to all groups. Do not oversell it.

**5. Eight weeks, five of them build, and nothing was cut.**
This is the question most likely to land, and the one to answer with a plan rather than optimism.
_The answer:_ the compression is absorbed by sequencing and by one deliberate piece of slack — the Context Resolver ships dark behind a fallback, so a slip there costs nothing and blocks no one. Report-only work (#20) is sequenced last, where slipping it costs a paragraph rather than a feature. Milestone 2's scope is scheduled to be re-examined once Milestone 1 gives a real velocity to plan against instead of an estimate.
_What to concede:_ Milestone 2 at Week 6 — real venues, real calendars, the rejection loop **and** cross-group conflicts in three weeks — is the tightest stretch in the plan.

**6. Two Google assumptions in the original spec were wrong. Both are now corrected — say so first.**

_Confirmed:_ an OAuth app in **Testing** status has its refresh tokens **expired by Google after 7 days**, by design and not configurable, with a 100 test-user cap. The original plan treated Testing mode as a free pass for v1; it is a weekly outage, and it can break a demo on the day.

_Confirmed:_ the **$200 monthly Places credit was withdrawn on 1 March 2025**, replaced by per-SKU free thresholds — 10,000 Essentials, 5,000 Pro, **1,000 Enterprise**. Opening hours and rating are Enterprise fields, and a request is billed at the highest tier it touches.

_The answer:_ both were caught by checking rather than by assuming, and both have a fix in the design already. The scope is being narrowed to `calendar.freebusy` — availability without event content — which appears to be **non-sensitive**, and a non-sensitive scope needs no verification, which means the app can publish In production and the 7-day timer disappears entirely. On Places, the two-tier cache was already in the design; the tier finding turns it from an optimisation into the thing that keeps the project inside the free allowance, and it adds one rule: **never put an Enterprise field in a wide search request** — search cheap, fetch expensive fields only for the ~20 on the shortlist.

_Still to confirm, and it is a two-minute check:_ the Cloud Console displays a scope's classification when you add it to the consent screen. Do this **before Week 2**, because the whole OAuth plan branches on it. _(§5.2, §6.3)_

---

## 5. Numbers to have at hand

|                    |                                                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Group size         | 3–6                                                                                                                           |
| Caps               | 3 rejection cycles · 3 open meetings per group · 1 free amendment per person per meeting · **one proposal on screen, always** |
| Shortlist          | 20–24, half by leximin and half by rating                                                                                     |
| Burden             | `straight-line × detour ÷ tolerance_km` — `1.0` is exactly at the stated limit                                                |
| Conflict           | same day, under 4 hours apart                                                                                                 |
| Feed refresh       | ~3s while re-weighing · ~30s otherwise · off in the background                                                                |
| Amendment batching | ~90s, closed by the next poll — no cron, no background job                                                                    |
| Models             | `gemini-3.6-flash` matching · `gemini-3.5-flash-lite` for both extraction components (spec §6.4)                              |
| Target run time    | ≤ 20s with visible progress                                                                                                   |
| Eval bar           | ≥ 80% pass, **zero** hard-constraint violations                                                                               |

---

## 6. What to ask the supervisor for

Three things worth actively soliciting, rather than waiting to be told:

1. **Is the measured multi-agent comparison (#20) worth its cost?** It is a second full implementation of a rejected architecture — the most valuable item in the plan for the report and the least valuable for the product. An explicit "yes, prioritise it" or "no, #54 is enough" changes the last three weeks.
2. **Is the eval set the right size and shape** for the claims being made, or should scenarios be traded for depth in the rejection-loop cases specifically?
3. **Is Milestone 2 at Week 6 credible**, or should the conflict work move behind the rejection loop and land after it?

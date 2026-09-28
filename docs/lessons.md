# Mistakes this project has already made

Twelve of them, each written up as the **class** of mistake rather than the
incident, because the incident is already fixed and the class is not.

Like [failure-modes.md](failure-modes.md), this page **collects** rather than
invents: every entry links to the code, commit or document where the real
write-up lives. Read it before adding a column, a fixture, or a test — three of
these cost a day each and every one of them looked correct while it was wrong.

Ordered by how expensive the next repeat would be, not by when it happened.

---

## 1. A passing test can be measuring nothing

The worst failure mode in this repo, because it produces **green**, and green
is not read twice.

**Twice in one afternoon, in the same eval file.** Scenario `08` asks whether a
rejection about price produces a visibly cheaper follow-up. It has two
candidate venues; a soft objection blocks the whole rejected one, so **exactly
one candidate survives and the agent physically cannot answer wrongly.** It
passes. It has always passed. It proves the chain ran — extraction, correction,
blocking, re-run, persistence — and it is not evidence that a stated preference
changed anybody's mind.

Then, worse: the scenario was briefly marked `scored` in the main sweep, which
runs **cycle 1** while `08`'s agreed answer describes **cycle 2**. The oracle
belonged to a different question. Cycle 1 happened to choose the venue cycle 2
was expected to, and a meaningless verdict came out green.

**The rule:** for every test, ask _what would have to be true for this to fail?_
If the answer is "nothing reachable", the test is documentation. Write down what
a pass actually proves, next to the test, in the words a sceptic would use.

Where: the note on `08` in [`evals/judge.ts`](../evals/judge.ts), and §3 step 8
of [tasks/a8-plan.md](../tasks/a8-plan.md).

## 2. A fixture that states what the code will do drifts from what the code does

`scenarioFollowupInput` built a second matching cycle by hand: it removed the
rejected venue, attached the correction to the rejecting participant, and set
`cycleNumber` to 2. All three were **predictions about code that did not exist
yet**. When A8 landed, two of the three turned out to be right and the harness
still had to go, because nothing kept it honest.

This is the shape of [#86](https://github.com/ron14y-sys/squad_lock/issues/86),
where a fixture described a venue as `"loud-bar"` and a rejection as
`avoid: ["loud", "bar-like"]` with nothing defining how the two compared.

**The rule:** a fixture states **inputs and the agreed answer**. The moment it
starts stating intermediate state, it has become a second implementation with
no tests of its own. Run the real stage over real inputs, even when that costs
a database.

Where: [`evals/loop.ts`](../evals/loop.ts) replaced it.

## 3. An updated row cannot carry a history

`Response.reasonText` and `respondedAt` are **overwritten** on every response.
Somebody who objected three times appeared once, carrying their third sentence,
stamped at the third time — which placed it **after** the re-weighings the
first one caused.

A timeline drawn from an updated row does not merely lose detail. **It puts the
cause after the effect and still looks correct.**

**The rule:** before adding a column to a row that gets updated, ask whether
anything will ever want the previous value. If yes, it is an append-only table,
not a column.

Found by Ron, from a scenario: _"no Asian food"_, then later _"no Italian
either"_. Where: the boxed note on `responses` in
[database-schema.md](database-schema.md).

## 4. A field-wise merge is not the same as replacing the object

The sibling of #3, one level down. Corrections accumulate into
`ParticipantMeetingContext.softPreferences`, and replacing the object wholesale
lost every earlier field. _"Not Asian"_ then _"and not Italian"_ are **two
facts**, not a change of mind — while _"too loud"_ then _"actually, lively is
fine"_ **is** one.

**The rule:** merge per field, newest wins per field. Test the accumulating
case _and_ the change-of-mind case; a test that only covers one will pass
either way.

Found by Ron, and it corrected reasoning I had already written down and
defended. Where: `mergeContexts` in
[`participant-meeting-context-from-row.ts`](../lib/types/participant-meeting-context-from-row.ts).

## 5. A timestamp cannot order an event against a row stamped at write time

A `MatchRun` row is created at the **end** of a run that takes 6–23 seconds. So
a rejection made _during_ that run is **older** than the run that never saw it,
and no comparison of `createdAt` values can distinguish it from a rejection the
run did read.

The first design for this guard was simply impossible, and it took writing it
out to see that.

**The rule:** when you need to know what a process saw, **record what it saw**.
Do not reconstruct it from when things happened. `MatchRunSeenContext` is two
columns and it answers exactly, where a timestamp answered approximately.

Where: decision 7 in [decisions/cycle-loop.md](decisions/cycle-loop.md).

## 6. A column default of `{}` behind a cast is a crash waiting for its first real row

`PreferenceProfile.hardConstraints` is `@default("{}")`. The converter cast it
to `HardConstraints`, which promises three arrays. Every user who signed up and
never opened the hard-constraints screen therefore carried a row whose type was
a lie, and the first code to iterate `unavailable` crashed.

It survived every test, because every test built its own profile with all three
arrays present. **The real database was the first thing to hold the default.**

**The rule:** a cast from `JsonValue` is a promise the database is not keeping.
Fill the shape in the converter, where the difference between what SQL stores
and what the app speaks is already being hidden.

Where: [`preference-profile-from-row.ts`](../lib/types/preference-profile-from-row.ts).

## 7. Concurrency arrives from your own client, not from users

C5 polls every three seconds while a meeting is re-weighing. A run takes 6–23
seconds. So roughly **five polls each started their own run** of the same
cycle. Only one could ever be written — `MatchRun` is unique on
`(meetingId, cycleNumber)` — but all five paid: five calls out of twenty a day,
and five times the Places quota.

The `await` on the client side was no help at all, because `after()` decouples
the run from the request, and three browsers cannot see each other's.

**The rule:** "one at a time" is a claim about shared state, so it lives in the
database. An optimistic claim on `updatedAt` is four lines.

Where: decision 5 in [decisions/cycle-loop.md](decisions/cycle-loop.md).

## 8. A capability with no data source is not a capability

`SoftPreferences` has four axes. A person can state all four, and A7 can
extract a correction into any of them. **Nothing on the venue side answers the
same four questions** — `VenueSoftFacts` has a documented producer ("B7 fills
it in") and B7 shipped without it, because its acceptance line never asked for
it.

So an eval scenario whose agreed answer was _"the only remaining candidate whose
own `soft.noiseLevel` is quiet"_ was measuring something the product cannot do,
and there is **no Places field at any SKU tier** that would ever close it. The
scenario was deleted.

**The rule:** when a type says another task fills it in, put it in that task's
acceptance line — not only in the type's comment. A field with no writer is a
feature that exists in the type system and nowhere else.

Where: [#139](https://github.com/ron14y-sys/squad_lock/issues/139). Its
sibling, [#132](https://github.com/ron14y-sys/squad_lock/issues/132), is the
same mistake with a form: `LocationForm.tsx` never sends `home`, so no profile
has coordinates and every real run raises.

## 9. Prove it for free before you spend the quota

Gemini allows 20 requests a day; Places allows **1,000 Enterprise requests a
month for the three of us together**. Both are shared, and both run out
silently in the middle of somebody else's work.

Every conclusion in A8's verification was reached deterministically first —
seeded caches, an injected calendar, `assembleRun` printed with no model call —
and only then paid for. The one real Places run counted **1 search + 20
details**, and it counted by wrapping `fetch` rather than by trusting a comment
about the field mask.

**The rule:** a claim you can reach with `console.log` is not worth a request.
And when you do spend, **count what left the machine** — a field mask that
grows a tier is otherwise invisible until the bill.

Where: [`scripts/verify-a8-places.ts`](../scripts/verify-a8-places.ts), and §5
of [tasks/a8-plan.md](../tasks/a8-plan.md).

## 10. A plan is not evidence, and a stale plan outlives the work

Two statements in A8's own plan were false, and both were only discovered by
trying to execute them (#1 above). The fix that matters is not that they were
wrong — it is that **the plan was corrected in the same commit**, with the
reasoning, rather than being quietly abandoned.

A plan that disagrees with the code is read by the next person as the
specification.

**The rule:** when execution contradicts the plan, edit the plan. In the same
commit. Say which of the two was wrong.

## 11. A spec can contradict itself, and picking silently is the error

§3.1 caps "reject-and-**rematch** cycles" at three. §6.3 remarks in passing
that "cycles 2 and 3 of a meeting are pure cache hits" — which only holds if
the opening proposal counts as a cycle. Both cannot be true.

§3.1 is the definition and §6.3 is an aside about caching written against the
other reading, so §3.1 governs: a meeting gets **four proposals** and all three
rejections are answered.

**The rule:** name the contradiction, choose the normative clause, and write
down which one you set aside and why. An undocumented choice between two spec
lines becomes a bug report from whoever read the other one.

Where: decision 2 in [decisions/cycle-loop.md](decisions/cycle-loop.md).

## 12. Two front doors to one model, and the credits are behind only one

Gemini is reachable through AI Studio (an API key) and through Vertex AI (a
Google Cloud project). They are **separate billing surfaces**: the AI Studio
project sat on a paid tier with a zero balance while the Cloud project held
₪891 of trial credit that is **not eligible** for it. The symptom was a bare
`402` on every call, which reads like a broken key.

`lib/llm/client.ts` now prefers Vertex when `GOOGLE_CLOUD_PROJECT` is set.
Location must be `global`; `us-central1` returns 404 for both models, and the
first call after enabling the API times out on a cold start.

**The rule:** when a managed service has two entry points, find out which one
your credits are attached to before concluding the credits are gone.

Where: `.env.example`, and
[PR #138](https://github.com/ron14y-sys/squad_lock/pull/138).

---

## The thread running through all twelve

Nine of the twelve **passed every check that existed** at the moment they were
introduced. Not one was caught by a type error, a lint rule, or a failing test;
they were caught by running the real thing against real data, or by somebody
describing a scenario out loud — _"what if Dana says no Asian food, and then
also no Italian?"_

That is the actual lesson, and it is already written in
[AGENTS.md](../AGENTS.md) in a smaller form: **a build step nothing exercises
yet is not working, it is merely untested.** The same is true of a column, a
merge rule, a cap, a fixture and a quota.

So: run it against the real thing once, deliberately, and count what it cost.

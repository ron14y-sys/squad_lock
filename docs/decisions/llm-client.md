# The LLM client — what A1 fixed in place, and what it leaves for later

**Task:** A1 ([tasks/todo.md](../../tasks/todo.md)) · **Feeds:** A4, A5, A7, A12 · **Status:** complete, [#76](https://github.com/ron14y-sys/squad_lock/pull/76)

[lib/llm/client.ts](../../lib/llm/client.ts) is the only place in this project that talks to Gemini. [lib/llm/cost.ts](../../lib/llm/cost.ts) is the only place that turns tokens into money. Everything in Track A that calls a model goes through them — the Group Matching Agent (A4), the Constraint Updater (A7), the Context Resolver (A12) — and no other file constructs a client, names a model, or sizes an output budget.

This page records the decisions taken while building them, because several of them are contracts that later tasks inherit rather than choices that stop mattering once the code is merged.

---

## What it is, and what it deliberately is not

**It is plumbing.** No prompts, no schemas, no domain logic. Those belong to the tasks that call it — A4 owns the matching prompt, A7 and A12 own theirs.

**What it does own** is the set of mistakes that are expensive to make once per caller instead of once in total: how big the output budget is, what a truncated response means, what a 429 means, which model each job uses, and what a call cost.

---

## The three lessons inherited from F2

[docs/decisions/runtime-budget.md](runtime-budget.md) measured the runtime and, in the process, found three ways to be wrong. All three are fixed here rather than left as advice.

### 1. An output cap must be sized for the thinking, not the answer

`max_output_tokens` is a single budget, and **thinking is spent from it**. At `high` the thinking dwarfs the answer: one measured run spent **24,299 thought tokens against 1,566 of output**. A cap of 16,000 — generous for the answer alone — cut a response off mid-object.

`MAX_OUTPUT_TOKENS` is 65,536, the models' documented ceiling. A call ends when the model is finished, never at a number we chose.

### 2. A truncated response is not a malformed one

`JSON.parse` blames the fragment either way, so the two failures are indistinguishable at the point they surface — and F2 lost an afternoon debugging a schema that was never wrong.

`LlmTruncatedError` is its own type, thrown when a stream ends without a completion event or an interaction ends in any state but `completed`. Its message names the cause and the fix. A caller that catches it knows to raise the cap or lower the thinking level, not to rewrite its schema.

### 3. A quota wall must surface immediately

The SDK retries a 429 by default, for minutes, in silence. That is indistinguishable from a hang, and it records a quota error as a latency measurement — which is how a benchmark quietly starts measuring itself.

`maxRetries: 0`, always. `isRateLimited` and `retryDelayMs` let the caller decide whether to wait, using the API's own retry hint rather than a backoff we invented.

---

## The decisions this task took

### The price table is not an allow-list

**This is the change most likely to be undone by someone trying to be careful, so it is written down here.**

The first version of A1 refused to run if the configured model was missing from `PRICING`. It was wrong in both directions:

- **A model released next week was blocked**, even though Google would have served it. New models appear constantly; ours would always be the last list to hear about it.
- **A model Google had already retired sailed through**, because it was still in our table. `gemini-2.5-pro` answers `404 no longer available to new users` — a fact only Google holds.

The block was answering the wrong question. There are two questions here, with two different owners:

| Question                                  | Who owns the answer               | How often it changes           |
| ----------------------------------------- | --------------------------------- | ------------------------------ |
| Does this model exist and may we call it? | **Google**                        | Constantly, without telling us |
| Do we know what it costs?                 | **Us**, by reading a pricing page | Only when someone reads one    |

So: **any model name reaches the API**, and Google's own error is the authority on existence. The wrapper appends the environment variable that produced the name, because Google's message is correct but does not know where the name came from.

### The cost of not knowing is a log line, not a failed run

An unpriced model produces `usd: null` and `basis: "unknown"`, and the call proceeds. The decision is still correct, the screens still work, the rejection loop still runs. What stops is the **cost figure**, and only where it is published.

**`usd` is `null`, never `0`.** A zero averages into a total as though it were a measurement.

### The guard lives where the consequence is

`assertReportableCost` refuses to publish a cost figure that would silently omit a model, and names it. **A5's eval runner calls it; nothing else does.**

The effect is that swapping a model never breaks a run, and the pressure to fill in a price lands on the person who needs the number, at the moment they need it.

### And it is not the only line of defence — because a contract nobody calls is a comment

The obvious way to total a run is wrong in a way nothing complains about:

```js
calls.reduce((sum, c) => sum + c.cost.usd, 0); // 0 + null === 0
```

A `null` disappears into that sum. The run prints `$0.07 per decision` when the honest answer is _"one of these was unpriced, so we do not know"_ — the exact failure `usd: null` exists to prevent, defeated by JavaScript's arithmetic on the way to the report.

`totalCost` makes the safe path the easy one: totalling costs the natural way returns a `CostTotal` whose `usd` is `null` the moment any part is unknown. `assertReportableCost` stays as the loud version, but the accident is no longer available.

**This is the repository's own recurring bug, and A1 shipped an instance of it before catching it.** [AGENTS.md](../../AGENTS.md) states it after #71: _a build step nothing exercises yet is not working, it is merely untested._ The first version of `assertReportableCost` was documented, tested, and called by nobody — an intention, not a mechanism.

### Thinking level is relaxed the same way, but flagged

Google's own SDK type is `"minimal" | "low" | "medium" | "high" | (string & {})` — that trailing `(string & {})` is Google saying any other string is valid too. So an unrecognised level passes through, for the same reason an unrecognised model does.

**The risk here is quieter, though, and that difference is the reason it is logged rather than simply allowed.** A wrong model name returns 404 within a second. A wrong thinking level may just be ignored and served at the API's default — an answer at a speed and price nobody asked for, with nothing saying so. So every call logs the level it _requested_, next to the duration and cost it _got_, plus `thinking_level_unrecognised=true` when it is not one of the four we know.

### `risesOn` is enforced, not commented

`gemini-3.6-flash` doubles on **2027-01-01**, and that fact first went in as a code comment nothing would ever read. `pendingPriceChanges` is called by a test, so the suite fails on the day and names the row to edit.

It fires only on an **announced** change, never on a merely old `readOn`. A suite that fails because a price is six months old is failing on a suspicion, and a test that cries wolf gets skipped.

### Cost is reported on the free tier, where the bill is zero

The report asks what a good group decision **would** cost ([spec §6.4](../spec.md)); the tier that happened to serve the tokens does not change that answer, and the figure will not jump on the day the project moves to the paid tier ([spec §13 item 17](../spec.md)).

**Thinking is billed at the output rate.** Thought tokens arrive in their own counter, which makes them easy to price as input or to forget entirely. On a thinking model they are nearly the whole bill: F2's worst measured run prices at **$0.103 a decision, roughly 97% of it thinking**.

### Model per task, by environment variable

| Task                   | Default model           | Thinking | Streams | Deadline |
| ---------------------- | ----------------------- | -------- | ------- | -------- |
| `matching` — A4        | `gemini-3.6-flash`      | `low`    | yes     | 290s     |
| `extraction` — A7, A12 | `gemini-3.5-flash-lite` | `low`    | no      | 60s      |

Configuration rather than code because **A10 is an experiment** — _can the lite model hold six profiles without dropping one?_ — and an experiment that needs a commit to change one value is an experiment nobody runs twice.

Overrides: `GEMINI_MATCHING_MODEL`, `GEMINI_MATCHING_THINKING`, `GEMINI_EXTRACTION_MODEL`, `GEMINI_EXTRACTION_THINKING`. Documented in [.env.example](../../.env.example).

**290s for matching** is just under Vercel's 300s function limit, so what stops a run is the platform limit the budget was measured against, not a number we invented. F2 had a client timeout of 180s abort a real 207.8s run and record the cap as the worst case — an instrument that silently truncates reports the instrument, not the system.

**Streaming for matching, non-streaming for extraction, through one code path.** Streaming inside the request is the architecture F2 tested ([spec §4.1e](../spec.md)); extraction returns one small object and has nothing to stream to. One path because the truncation check, the token accounting and the cost line are exactly the parts that drift when written twice.

---

## What later tasks inherit

| Task                             | What it gets, and what it must respect                                                                                                                                                                                                                     |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A4** — matching agent          | `generate({ task: "matching", ... })` streams and validates nothing about content. Supply a `jsonSchema`; "no free-text parsing" is A4's own acceptance criterion. Catch `LlmTruncatedError` distinctly from a schema failure — they have different fixes. |
| **A5** — eval runner             | Use `totalCost`, never a hand-written sum. Call `assertReportableCost` before printing a cost column. `cost.usd` may be `null` and that is a result, not a bug.                                                                                            |
| **A7 / A12** — the twins         | `generate({ task: "extraction", ... })`, non-streaming, one small validated object out. They share prompt, schema and validation conventions with each other ([D7](design-decisions.md)); this client is the part they already share.                      |
| **A10** — model and effort check | Change an environment variable, not a file. Any model name is accepted; add its price to `PRICING` before quoting a cost from the run.                                                                                                                     |
| **Whoever adopts a new model**   | One entry in `PRICING`, with `readOn` set to the day the price was read. Nothing else in the code changes, and nothing breaks while the entry is missing.                                                                                                  |

---

## What is not decided here

- **Nothing is persisted.** `MatchRun` has no token or cost columns, so a call reports through a log line and an `onUsage` callback. Adding columns belongs with **A4**, which is what creates a run in the first place.
- **Prompt caching is not implemented.** The prefix repeats across the cycles of one proposal ([spec §6.4](../spec.md)), and the earliest caller is **A8**'s cycle loop. Until then `cachedTokens` is zero and the cost figure is exact; if it is ever non-zero the figure becomes `approximate` and says so, rather than being quietly wrong.
- **Free tier versus paid is still open**, with a deadline — [spec §13 item 17](../spec.md). Nothing here depends on the answer, and everything here reports a number that survives it.

---

## How A1 was verified

The backlog gave A1 no `Verify` line. It has one now: **42 tests**, no key and no network, over the parts that can be wrong while the API stays silent — the price arithmetic, which model each task resolves to, the totalling rules, and the error types.

Both call paths were also exercised by hand against the real API, including the retired-model path:

```
[llm] task=extraction model=gemini-3.5-flash-lite thinking=low ms=2183 in=21 out=12 thought=0 cost=$0.000036

404 This model models/gemini-2.5-pro is no longer available to new users...
 — model "gemini-2.5-pro" for task "extraction". It may have been retired;
 check GEMINI_EXTRACTION_MODEL against https://ai.google.dev/gemini-api/docs/models.
```

Those files were thrown away rather than committed. **A test that needs a key is a test CI always skips**, and this repository has been caught once already by a guarantee nothing exercised.

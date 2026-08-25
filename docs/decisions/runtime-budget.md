# Runtime budget — does a matching run fit inside a Vercel function?

**Task:** F2 ([tasks/todo.md](../../tasks/todo.md)) · **Blocks:** A4 (Group Matching Agent)
**Status:** measured limits recorded; **the run itself is not yet measured** — see [Results](#results).

---

## The question

[Spec §4.1e](../spec.md) states that a matching run "may stream inside a request; it no longer needs a background job." That is an assumption. This file is where it becomes a measurement, or stops being true.

If the real worst case does not fit, the consequence is not a shorter prompt — it is a background job, a queue and a results store, which is a change across all three tracks. That is why the measurement comes in Week 1 rather than Week 5.

## The three numbers

| Number                    | Value                                                 | Kind                                                       |
| ------------------------- | ----------------------------------------------------- | ---------------------------------------------------------- |
| **Vercel function limit** | **300s** — Hobby default _and_ maximum, fluid compute | Hard wall. Past it, a 504 `FUNCTION_INVOCATION_TIMEOUT`    |
| **Product target**        | **20s**, success criterion 6                          | A target, not a wall. Missing it is a finding, not a crash |
| **Worst-case run**        | _not yet measured_                                    | What we actually spend                                     |

**Source for the limit:** [Vercel Functions Limits](https://vercel.com/docs/functions/limitations), read 2026-08-25. Hobby is 300s default and 300s maximum with fluid compute (on by default for new projects); Pro reaches 800s. Re-check before quoting this in the report — Vercel changes it, and this project has already been wrong once by inheriting a provider's numbers from memory ([spec §6.3](../spec.md) on the withdrawn Places credit).

The margin is large. A 20-second target against a 300-second wall means the architecture has room; the measurement is to confirm that, not to squeeze into it.

## What is being measured

`POST /api/spike/match` runs one real Gemini call over a deliberately worst-case payload and reports its own timings. Not a toy prompt — the input is the shape of a real run:

- **6 participants** — the largest realistic group, each with hard constraints, soft preferences, home neighbourhood, `tolerance_km`, recurring mobility rules and five calendar busy blocks
- **24 candidates** — the top of the shortlist range [B7c](../../tasks/todo.md) produces, each with coordinates, opening hours, attributes and a straight-line distance per participant
- **Cycle 3, with a rejection history** — the longest run the system can ask for
- **The real output shape** — a schema-validated ranked top 3, each option a `(venue, datetime)` pair with a justification for every one of the six people ([§4.1a, §4.1c](../spec.md))

Payload size: **~17,200 characters, roughly 4,700 input tokens.** Fixed and deterministic, so two measurements are comparable.

The call **streams**, because streaming inside the request is the thing being tested. A non-streaming call would measure something the product does not do.

## Files

| File                                                               | What it is                                                     |
| ------------------------------------------------------------------ | -------------------------------------------------------------- |
| [lib/spike/payload.ts](../../lib/spike/payload.ts)                 | The fabricated worst-case payload                              |
| [lib/spike/schema.ts](../../lib/spike/schema.ts)                   | The output schema — the spike's stand-in for A4's              |
| [lib/spike/match.ts](../../lib/spike/match.ts)                     | The timed streaming call                                       |
| [app/api/spike/match/route.ts](../../app/api/spike/match/route.ts) | The route, `maxDuration = 300`, guarded by `SPIKE_ENABLED`     |
| [scripts/spike-runtime.mjs](../../scripts/spike-runtime.mjs)       | Runs it N times per model and thinking level, prints the table |

This is spike code. It is throwaway — A4 writes the real agent, prompt and schema against the budget recorded here.

## How to run it

```
cp .env.example .env.local     # then put a real GEMINI_API_KEY in it
                               # and set SPIKE_ENABLED=1
npm run dev
npm run spike:runtime          # 5 runs x 2 models x 2 thinking levels
```

Against the deployed app, once F6 lands:

```
npm run spike:runtime -- --url=https://<the-deployment>
```

**The deployed number is the one that counts.** A laptop is not a serverless function. Take the local number as an early read and replace it when F6 exists.

Five runs per combination, not one: LLM latency varies enough that a single number is an anecdote. The table reports the median and the worst, and **it is the worst that goes up against the limit**.

## Results

_Not yet run._

Paste the table from `npm run spike:runtime` here, both local and deployed.

### Local

Measured 2026-08-25 against `http://localhost:3000`, 5 runs per row.

| Model                   | Thinking | Runs | Median    | Worst     | First text | In / out / thought tokens | Covers all 6 |
| ----------------------- | -------- | ---- | --------- | --------- | ---------- | ------------------------- | ------------ |
| `gemini-3.5-flash-lite` | low      | 5    | **5.6s**  | **42.5s** | 1.2s       | 8045 / 910 / 0            | yes          |
| `gemini-3.5-flash-lite` | high     | 5    | **60.8s** | **64.7s** | 54.7s      | 8045 / 1169 / 19912       | yes          |
| `gemini-3.6-flash`      | low      | 5    | **63.5s** | **74.5s** | 23.0s      | 8045 / 1212 / 5011        | yes          |
| `gemini-3.6-flash`      | high     | —    | _blocked_ | _blocked_ | _blocked_  | _blocked_                 | _blocked_    |

The last row is blocked on the free tier's **daily** quota, not on anything about the run — see [The free tier does not fit this project](#the-free-tier-does-not-fit-this-project).

**Four things these numbers say.**

1. **The function limit is not the constraint.** The worst run was 74.5s against a 300s wall. Spec §4.1e holds: a matching run streams inside a request, and the background job the superseded architecture needed is genuinely not needed. **This is the question F2 existed to answer, and it is answered.**
2. **The 20-second product target is the constraint.** Exactly one configuration fits it — `gemini-3.5-flash-lite` at `low`, and only at the median. Everything else runs 60–75s. Per spec §12 that is "a finding about the architecture, not just a slow run".
3. **Thinking costs about a minute, flat.** Both models land near 60s once thinking is on, and the thought tokens are 17–20× the answer itself (19,912 thought tokens against 1,169 of output). Whether that minute buys anything is [A10](../../tasks/todo.md)'s question — F2 only establishes what it costs.
4. **The tail is far worse than the median, and that is the most dangerous number here.** `gemini-3.5-flash-lite` at `low` ran 5.6s at the median and **42.5s at its worst** — an eight-fold spread on byte-identical input. A budget written against the median would be wrong precisely when it mattered. **Whatever A4 promises, it has to survive the worst run.**

**First text is its own problem.** 23 seconds of silence on `gemini-3.6-flash`, and **55 seconds** on the lite model at `high`, before a single character appears — thinking happens before any output. The run succeeds; the person watching the screen cannot tell. Deterministic progress from the funnel stages (§4.1e) is not a nicety here, it is the only thing between a working run and a frozen-looking screen.

### The free tier does not fit this project

`gemini-3.6-flash` allows **20 requests per day** on the free tier — `GenerateRequestsPerDayPerProjectPerModel-FreeTier`, read from the API's own quota response on 2026-08-25. Not per minute. Per day, resetting at midnight Pacific.

Twenty requests is enough to take a measurement. It is not enough to build against:

- **[F5](../../tasks/todo.md)'s eval set is 8–12 scenarios.** One `npm run eval` ([A5](../../tasks/todo.md)) is most of a day's quota. Two runs in an afternoon is not possible.
- **The rejection loop ([A7](../../tasks/todo.md), [A8](../../tasks/todo.md)) is up to 3 cycles per meeting.** A handful of manual tests exhausts the day.
- **Dogfooding in weeks 7–8** puts real groups through real runs. That alone exceeds it.

Per-model daily limits differ and are not published — they are visible per account at [ai.dev/rate-limit](https://ai.dev/rate-limit). `gemini-3.5-flash-lite` clearly allows more than 20, since it completed ten runs plus diagnostics.

**This is an open decision, and it is now urgent rather than theoretical.** The options are to pin development to whichever free model has a workable daily limit, or to move to the paid tier. The paid tier also settles the privacy problem below, which has to be settled before any real user data flows through the API regardless.

### Truncation — a bug this measurement found

The first attempt at both `high` rows failed with a JSON parse error at ~2,500 characters. The cause was `max_output_tokens: 16000`: **thinking tokens are spent from the same budget as the answer**, and at `high` they dwarf it — one run spent 20,424 thought tokens against 1,183 of actual output. The response was cut off mid-object.

Two fixes, both in [lib/spike/match.ts](../../lib/spike/match.ts): the budget is now 65,536 (the models' documented ceiling), and a stream that ends without a completion event now says it was truncated instead of blaming the JSON. **A4 inherits this**: any output cap has to hold the thinking as well as the answer, and a truncated response must fail loudly rather than look like a malformed one.

### Deployed (Vercel Hobby)

| Model | Thinking | Runs | Median | Worst | First text | In / out / thought tokens | Covers all 6 |
| ----- | -------- | ---- | ------ | ----- | ---------- | ------------------------- | ------------ |
|       |          |      |        |       |            |                           |              |

### Verdict

_To be written once the numbers exist. One line: does streaming inside a request hold, yes or no. If no, say what replaces it._

## The provider

**The matching call runs on the Gemini API, not on Claude.** The reason is money: the Gemini API has a free tier that needs no billing account and no credit card, and Anthropic's API has no free tier — a Claude Pro or Max subscription buys the apps, not API credits.

**Choosing the models was not a preference — the free tier decided it.** Four candidates were tried against this project's key on 2026-08-25:

| Model                    | What the API said                                                 |
| ------------------------ | ----------------------------------------------------------------- |
| `gemini-2.5-pro`         | 404 — "no longer available to new users"                          |
| `gemini-3.1-pro-preview` | Quota of **0** on the free tier                                   |
| `gemini-3.7-flash`       | "currently experiencing high demand", after ~2 minutes of waiting |
| `gemini-3.5-flash-lite`  | **Works** — 4.8s, 3 options, all six justified                    |
| `gemini-3.6-flash`       | **Works** — 30.6s, 3 options, all six justified                   |

**The free tier is flash-class only.** Every pro-class model returns a quota of zero. That is a finding with consequences past this task: [A10](../../tasks/todo.md) asks whether a small model can hold six profiles without dropping one, and on the free tier that is not a question the project gets to answer either way — it is the only option available. On the single runs above, all three working models covered all six participants, which is an encouraging first signal and not yet evidence.

So the two measured models are **`gemini-3.5-flash-lite`** (does not think — fast) and **`gemini-3.6-flash`** (thinks — slower), chosen to span the range rather than sit next to each other.

**Two thinking levels** — `low` and `high`, Gemini's version of an effort dial. It is the cheapest latency knob available, and what `low` costs in quality is [A10](../../tasks/todo.md)'s question later; here it is only being timed.

### An early read, from single runs

Not the measurement — one run each, taken while getting the spike working. Recorded because it is the first real evidence:

| Model                   | Thinking | Total | First text | In / out / thought tokens | Covers all 6 |
| ----------------------- | -------- | ----- | ---------- | ------------------------- | ------------ |
| `gemini-3.5-flash-lite` | low      | 4.8s  | 1.0s       | 8045 / 898 / 0            | yes          |
| `gemini-3.6-flash`      | low      | 30.6s | 22.8s      | 8045 / 1205 / 4663        | yes          |

Both sit far inside the 300-second function limit. The lite model also sits inside the 20-second product target; the flash model does not. **Note the first-text column** — 23 seconds of silence before a single character appears is a real product problem even though the run completes, and it is exactly what the progress reporting in §5.6 exists for.

### Three things the free tier costs that money does not

1. **Rate limits, and they are tight.** The free tier allows **5 requests per minute, per model** (`GenerateRequestsPerMinutePerProjectPerModel-FreeTier`) — one call every 12 seconds. Measured against this key on 2026-08-25, not read from a doc. The runner leaves a 20-second gap for headroom (`--gap=<seconds>`) and re-takes any run that comes back a quota error, waiting out the window the API names. **A 429 is not a latency result**, and a runner that recorded one as a 0.4-second run would be lying about the very thing this file exists to measure.

   The SDK compounds this: by default it retries a 429 silently for minutes, which looks exactly like a hang. The spike sets `maxRetries: 0` so the quota error surfaces and the runner, not the SDK, decides what to do about it.

2. **Free-tier prompts are used to improve Google's products.** Google's [pricing page](https://ai.google.dev/gemini-api/docs/pricing) states this plainly: free tier "used to improve our products — yes", paid tier "no". Fabricated spike data is fine. **Real participants' preferences, home neighbourhoods and calendar availability are not** — [spec §10](../spec.md) commits this project to least privilege, and this contradicts it. **Before any real user data touches the API, the project has to move to the paid tier.** That is an open decision, not a settled one.
3. **The spec still says Anthropic.** [A1](../../tasks/todo.md) names `claude-sonnet-5` and `claude-haiku-4-5`; [spec §6.3](../spec.md) lists an Anthropic API key as a dependency. Those documents have not been updated and now disagree with the code.

## Notes for whoever reads the numbers

- **Cost per run is not reported**, because on the free tier it is zero. Token counts are reported instead — they are what turns into money on the day the project moves to the paid tier, and they do not change when the price does.
- **`Covers all 6`** is not a latency measurement. It is an early read on the [A6](../../tasks/todo.md) risk — a single agent holding six profiles quietly dropping one. If it ever says `NO`, that is a finding worth more than the timings.
- **The spike route is reachable on the public deploy URL**, which is why it refuses to run unless `SPIKE_ENABLED=1`. The free tier costs nothing, but a stranger can burn the rate limit. Turn it off after measuring.

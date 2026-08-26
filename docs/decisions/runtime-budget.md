# Runtime budget — does a matching run fit inside a Vercel function?

**Task:** F2 ([tasks/todo.md](../../tasks/todo.md)) · **Blocks:** A4 (Group Matching Agent)
**Status:** complete. Measured locally across four configurations and on the deployment. **Verdict: it fits — see [Verdict](#verdict).** A4 is unblocked.

---

## The question

[Spec §4.1e](../spec.md) states that a matching run "may stream inside a request; it no longer needs a background job." That is an assumption. This file is where it becomes a measurement, or stops being true.

If the real worst case does not fit, the consequence is not a shorter prompt — it is a background job, a queue and a results store, which is a change across all three tracks. That is why the measurement comes in Week 1 rather than Week 5.

## The three numbers

| Number                    | Value                                                                                       | Kind                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **Vercel function limit** | **300s** — Hobby default _and_ maximum, fluid compute                                       | Hard wall. Past it, a 504 `FUNCTION_INVOCATION_TIMEOUT`    |
| **Product target**        | **20s**, success criterion 6                                                                | A target, not a wall. Missing it is a finding, not a crash |
| **Worst-case run**        | **207.8s** measured locally — `gemini-3.6-flash` / `high`; 42.5s on the lite model at `low` | What we actually spend                                     |

**Source for the limit:** [Vercel Functions Limits](https://vercel.com/docs/functions/limitations), read 2026-08-25. Hobby is 300s default and 300s maximum with fluid compute (on by default for new projects); Pro reaches 800s. Re-check before quoting this in the report — Vercel changes it, and this project has already been wrong once by inheriting a provider's numbers from memory ([spec §6.3](../spec.md) on the withdrawn Places credit).

The wall is far away, but how far depends entirely on the configuration: the worst run on the lite model used 14% of the budget, and the worst on `gemini-3.6-flash` at `high` used 69%. The 20-second product target, not the 300-second wall, is what the measurement actually strains against.

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

Both passes are done. Local characterises the range across models and thinking levels; the deployed pass answers whether the platform itself adds cost.

### Local

Measured 2026-08-25 and 2026-08-26 against `http://localhost:3000`, 5 runs per row.

| Model                   | Thinking | Runs | Median     | Worst      | First text | In / out / thought tokens | Covers all 6 | Worst as % of the 300s limit |
| ----------------------- | -------- | ---- | ---------- | ---------- | ---------- | ------------------------- | ------------ | ---------------------------- |
| `gemini-3.5-flash-lite` | low      | 5    | **5.6s**   | **42.5s**  | 1.2s       | 8045 / 910 / 0            | yes          | 14%                          |
| `gemini-3.5-flash-lite` | high     | 5    | **60.8s**  | **64.7s**  | 54.7s      | 8045 / 1169 / 19912       | yes          | 22%                          |
| `gemini-3.6-flash`      | low      | 5    | **63.5s**  | **74.5s**  | 23.0s      | 8045 / 1212 / 5011        | yes          | 25%                          |
| `gemini-3.6-flash`      | high     | 5    | **165.1s** | **207.8s** | 152.4s     | 8045 / 1566 / 24299       | yes          | **69%**                      |

**All four configurations produced 3 ranked options and justified all six participants, every time.** Twenty runs, no dropped participant. That is the first real evidence against the §9 risk that a single agent holding six profiles quietly skips one — encouraging, and not a substitute for [A6](../../tasks/todo.md)'s dedicated check.

**The headline holds: a run fits inside the function.** Spec §4.1e stands, and the background job the superseded architecture needed is genuinely unnecessary.

**But the margin is not one number — it ranges from comfortable to thin.**

1. **`gemini-3.5-flash-lite` at `low` has real headroom.** 42.5s worst, 14% of the budget. Nothing about the function limit constrains it.
2. **`gemini-3.6-flash` at `high` does not.** 207.8s worst is **69% of the 300s limit**, from a laptop, on a fixed payload, with no cold start and no network variance. A slower day pushes it over. This configuration should not be treated as available without more evidence.
3. **The 20-second product target is missed almost everywhere.** Exactly one configuration meets it — lite at `low`, and only at the median. Per [§12](../spec.md) that is "a finding about the architecture, not just a slow run", and it belongs in the Milestone 1 conversation.
4. **The tail is far worse than the median, on every row.** Lite at `low` is the extreme: 5.6s median, 42.5s worst — an eight-fold spread on byte-identical input. **Whatever [A4](../../tasks/todo.md) promises, it has to survive the worst run, not the typical one.**

**First text is its own problem, and it scales with thinking.** 1.2s on the lite model at `low`; **152 seconds** on `gemini-3.6-flash` at `high`. Two and a half minutes before a single character appears, because thinking precedes output. The run succeeds; the person watching the screen has no way to know that. Deterministic progress from the funnel stages (§4.1e) is not a nicety — it is the only thing between a working run and a screen that looks frozen.

### A measurement that was almost wrong

The first pass at the `gemini-3.6-flash` / `high` row reported a worst case of 175.7s. **That number was an artefact of the measuring instrument**: the spike set a 180-second client timeout, and one run was aborted at exactly 180.0s while still working. The recorded "worst" was the cap, not the run.

Raised to 290s — just under the function limit, so what stops a run is the limit being measured against rather than a number the spike picked. The honest worst is **207.8s**, and two of the five runs exceeded the old cap.

The lesson generalises past this file: **an instrument that silently truncates reports the instrument, not the system.** F2 exists to find the worst case, and it had quietly capped it.

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

Measured 2026-08-26 against `https://squadlock.vercel.app`. **3 runs, one configuration** — deliberately small: the free tier's daily quota is the scarce resource, and the question the deployed pass has to answer is narrow.

| Model                   | Thinking | Runs | Median   | Worst    | First text | In / out / thought tokens | Covers all 6 |
| ----------------------- | -------- | ---- | -------- | -------- | ---------- | ------------------------- | ------------ |
| `gemini-3.5-flash-lite` | low      | 3    | **4.6s** | **4.7s** | 0.9s       | 8045 / 1007 / 0           | yes          |

**The serverless function is not slower than the laptop. It is faster, and far steadier.**

|                     | Local (5 runs) | Deployed (3 runs) |
| ------------------- | -------------- | ----------------- |
| Median              | 5.6s           | **4.6s**          |
| Worst               | 42.5s          | **4.7s**          |
| Spread worst/median | 7.6×           | **1.02×**         |

That answers the question this pass existed to ask — _does the platform add cost the laptop hid?_ — with a clear no. Cold start, function overhead and the network between Vercel and Google add nothing measurable here.

**It also reframes the local tail.** The 42.5s outlier on the same configuration is very unlikely to be the model: three deployed runs landed inside 200ms of each other on identical input. The likelier cause is the laptop's own network. **That does not make the tail disappear — it moves the suspicion from the provider to the local environment**, and the [A4](../../tasks/todo.md) rule stands unchanged, because production still has to survive whatever the worst run turns out to be.

**What these three runs do not establish.** Three runs cannot characterise a tail — that is the whole reason the local rows took five. A worst case of 4.7s out of three attempts is a statement about three attempts. If the deployed tail ever matters to a decision, it needs a real sample, on a day when quota is not the binding constraint.

### Verdict

**Yes. A matching run streams inside a Vercel function, and no background job is needed.** Spec §4.1e holds as written, [A4](../../tasks/todo.md) is unblocked, and the background-job infrastructure the superseded architecture required stays off the table.

Measured, not assumed: worst observed run **207.8s against a 300s limit** in the slowest configuration, **4.7s** in the one the product would actually ship. Deploying costs nothing — the function is faster and steadier than the development machine.

Three qualifications travel with that answer:

- **The margin depends on the configuration**, from 14% of the budget to 69%. `gemini-3.6-flash` at `high` is not comfortably inside the limit and should not be treated as available without more evidence.
- **The 20-second product target (§12, criterion 6) is a different question, and mostly the answer is no.** One configuration meets it. That belongs in the Milestone 1 conversation, not in A4's way.
- **The provider and the free tier are unresolved** — see below. Neither blocks A4; both have deadlines.

**F2's acceptance is met.** What remains open in this file is recorded as open.

## The provider

**The matching call runs on the Gemini API, not on Claude.** The reason is money: the Gemini API has a free tier that needs no billing account and no credit card, and Anthropic's API has no free tier — a Claude Pro or Max subscription buys the apps, not API credits.

**This started as a spike-scoped choice and became the project's.** On 2026-08-26 the documents were brought in line with the code: [spec §6.4](../spec.md) rewritten for Gemini with prices read from Google's pricing page that day, A1 renamed from "Anthropic client" to "Gemini client", `ANTHROPIC_API_KEY` replaced by `GEMINI_API_KEY` in `.env.example`, and the free-tier-versus-paid choice recorded as a new open question — [§13, item 17](../spec.md). Nothing in the repository names Claude as this project's provider any more.

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

## Notes for whoever reads the numbers

- **Cost per run is not reported**, because on the free tier it is zero. Token counts are reported instead — they are what turns into money on the day the project moves to the paid tier, and they do not change when the price does.
- **`Covers all 6`** is not a latency measurement. It is an early read on the [A6](../../tasks/todo.md) risk — a single agent holding six profiles quietly dropping one. If it ever says `NO`, that is a finding worth more than the timings.
- **The spike route is reachable on the public deploy URL**, which is why it refuses to run unless `SPIKE_ENABLED=1`. The free tier costs nothing, but a stranger can burn the rate limit. Turn it off after measuring.

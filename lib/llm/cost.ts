/**
 * A1 — what a call to Gemini costs.
 *
 * Cost is tracked here not because the bill matters — at this scale it is a few
 * dollars in total — but because "what does a good group decision cost" is a
 * research finding the report has to state ([spec §6.4](../../docs/spec.md)),
 * and because [A5](../../tasks/todo.md)'s eval runner is required to print a
 * dollar figure per scenario.
 *
 * **This table is not a list of models we are allowed to call.** It is a list of
 * models whose price we happen to know. The two are different questions with
 * different owners: Google decides what exists, and it changes the answer
 * without telling us; we decide what we have read off a pricing page. Using one
 * to answer the other was wrong in both directions — it blocked models Google
 * would have served, and waved through models Google had already retired.
 *
 * So an unknown model is priced `unknown` and the call goes ahead. What refuses
 * to proceed is the *report* — see `assertReportableCost`.
 *
 * No network, no SDK, no environment. Pure arithmetic over a price table.
 */

export type PriceRow = {
  /** US dollars per 1M input tokens, paid tier. */
  inputPerM: number;
  /** US dollars per 1M output tokens, paid tier. Thinking is billed at this rate. */
  outputPerM: number;
  /** The day a human read this off Google's pricing page. Not decorative — see below. */
  readOn: string;
  /** A price change Google has already announced. Enforced, not commented — see `pendingPriceChanges`. */
  risesOn?: { on: string; inputPerM: number; outputPerM: number };
};

/**
 * ⚠️ **Prices read from https://ai.google.dev/gemini-api/docs/pricing on the
 * date in each row.** Re-read them before quoting any of them in the report.
 * This repository has already been wrong twice by inheriting a provider's
 * numbers from memory rather than from the page ([spec §6.4](../../docs/spec.md)).
 *
 * Adding a model here is the whole cost of adopting one. Nothing else in the
 * code needs to change, and nothing breaks while it is missing.
 */
export const PRICING: Record<string, PriceRow> = {
  /** Development, repeated runs, and both extraction components. Does not think. */
  "gemini-3.5-flash-lite": {
    inputPerM: 0.3,
    outputPerM: 2.5,
    readOn: "2026-08-26",
  },
  /** The matching agent. Thinks, and the thinking is most of the bill. */
  "gemini-3.6-flash": {
    inputPerM: 0.75,
    outputPerM: 3.75,
    readOn: "2026-08-26",
    risesOn: { on: "2027-01-01", inputPerM: 1.5, outputPerM: 7.5 },
  },
  "gemini-3.5-flash": {
    inputPerM: 1.5,
    outputPerM: 9.0,
    readOn: "2026-08-26",
  },
};

export const PRICED_MODELS = Object.keys(PRICING);

/** Whether we know this model's price. **Not** whether we may call it. */
export function isPricedModel(model: string): boolean {
  return model in PRICING;
}

/**
 * What one call spent. Three counters, not two: **thought tokens are their own
 * number**, and on a thinking model they dwarf the answer — a measured run spent
 * 24,299 thought tokens against 1,566 of output
 * ([F2](../../docs/decisions/runtime-budget.md)).
 */
export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  /** Part of the input served from a cached prefix. Not used yet — see `priceCall`. */
  cachedTokens: number;
};

export const ZERO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  thoughtTokens: 0,
  cachedTokens: 0,
};

/**
 * How much to trust the figure. One field, carried with the number, so nothing
 * downstream has to guess and nobody can mistake a blank for a zero.
 *
 * - `exact` — priced from a row in the table.
 * - `approximate` — priced, but part of the input came from a cache we do not model.
 * - `unknown` — no price for this model. `usd` is `null`, never `0`.
 */
export type CostBasis = "exact" | "approximate" | "unknown";

export type Cost = {
  model: string;
  usd: number | null;
  basis: CostBasis;
};

/**
 * Prices one call.
 *
 * **Thinking is billed as output.** Thought tokens are counted separately by the
 * API but priced at the output rate, so they are added to the output side. On a
 * thinking model that is where nearly the whole cost lives — charging them at
 * the input rate, or not at all, would understate a matching run by roughly an
 * order of magnitude.
 *
 * **Cached input is not discounted.** Prompt caching reads at 0.1× and writes at
 * 1.25× ([spec §6.4](../../docs/spec.md)), and nothing here caches yet — the
 * earliest caller is the cycle loop in [A8](../../tasks/todo.md). While
 * `cachedTokens` is zero the figure is exact; if it is ever non-zero the figure
 * is an over-estimate and says so through `basis`, rather than being quietly
 * wrong.
 *
 * **Reported even on the free tier, where the real bill is zero.** The question
 * the report asks is what a decision would cost; the tier that happened to serve
 * the tokens does not change the answer, and the number will not jump on the day
 * the project moves to the paid tier ([spec §13 item 17](../../docs/spec.md)).
 */
export function priceCall(model: string, usage: TokenUsage): Cost {
  const row = PRICING[model];
  if (!row) return { model, usd: null, basis: "unknown" };

  const billedOutput = usage.outputTokens + usage.thoughtTokens;
  const usd =
    (usage.inputTokens * row.inputPerM) / 1_000_000 +
    (billedOutput * row.outputPerM) / 1_000_000;

  return {
    model,
    usd,
    basis: usage.cachedTokens > 0 ? "approximate" : "exact",
  };
}

/** `$0.103028` · `~$0.103028 (cached input not discounted)` · `unpriced(...)`. */
export function describeCost(cost: Cost): string {
  if (cost.basis === "unknown") {
    return `unpriced(${cost.model} — add it to PRICING in lib/llm/cost.ts)`;
  }
  const amount = `$${(cost.usd ?? 0).toFixed(6)}`;
  return cost.basis === "approximate"
    ? `~${amount} (cached input not discounted)`
    : amount;
}

/** The models among these costs that we could not price. */
export function unpricedModels(costs: Cost[]): string[] {
  return [
    ...new Set(costs.filter((c) => c.basis === "unknown").map((c) => c.model)),
  ];
}

/**
 * **The guard, moved to the one place it belongs.**
 *
 * A run with an unpriced model is fine — the decision is still correct, the
 * screens still work, the rejection loop still runs. What is *not* fine is
 * publishing a cost-per-decision figure that silently omits it. So
 * [A5](../../tasks/todo.md)'s eval runner calls this before printing its cost
 * column, and nothing else does.
 *
 * The effect: swapping a model never breaks a run, and the pressure to fill in
 * a price lands on the person who needs the number, at the moment they need it.
 */
export function assertReportableCost(costs: Cost[]): void {
  const missing = unpricedModels(costs);
  if (missing.length === 0) return;
  throw new Error(
    `Cannot report a cost figure: no price for ${missing.join(", ")}. ` +
      `Add ${missing.length === 1 ? "it" : "them"} to PRICING in lib/llm/cost.ts, ` +
      `with the price read from https://ai.google.dev/gemini-api/docs/pricing on the day — not from memory.`
  );
}

/**
 * Price changes Google has announced whose date has now passed, so the table is
 * knowably wrong.
 *
 * This exists because [AGENTS.md](../../AGENTS.md) says it: *a comment is not a
 * script.* `gemini-3.6-flash` doubles on 2027-01-01, and until now that fact
 * lived in a code comment that nothing would ever read. A test calls this, so
 * the day the price changes the suite fails and names the row to edit.
 *
 * Deliberately narrow: it fires only on a **known** change, never on a merely
 * old `readOn`. A suite that fails because a price is six months old would be
 * failing on a suspicion, and a test that cries wolf gets skipped.
 */
export function pendingPriceChanges(today: Date): string[] {
  return Object.entries(PRICING)
    .filter(([, row]) => row.risesOn && new Date(row.risesOn.on) <= today)
    .map(
      ([model, row]) =>
        `${model}: ${row.risesOn!.on} has passed — the table still says ` +
        `${row.inputPerM}/${row.outputPerM}, the announced price is ` +
        `${row.risesOn!.inputPerM}/${row.risesOn!.outputPerM}`
    );
}

/**
 * The cost of several calls together — one scenario, one cycle, one eval run.
 *
 * Spans models, so it names them rather than one.
 */
export type CostTotal = {
  usd: number | null;
  basis: CostBasis;
  /** Every model that contributed, in the order first seen. */
  models: string[];
  /** The ones with no price. Empty unless `basis` is `unknown`. */
  unpriced: string[];
};

/**
 * Adds up costs **without letting an unknown become a zero.**
 *
 * This exists because the obvious way to total a run is wrong in a way nothing
 * complains about:
 *
 * ```js
 * calls.reduce((sum, c) => sum + c.cost.usd, 0)   // 0 + null === 0
 * ```
 *
 * A `null` disappears into that sum. The run prints `$0.07 per decision` when
 * the honest answer is "one of these was unpriced, so we do not know" — the
 * exact failure `usd: null` was introduced to prevent, defeated by JavaScript's
 * arithmetic on the way to the report.
 *
 * So the safe path is the easy one: totalling costs the natural way produces a
 * `CostTotal` whose `usd` is `null` the moment any part is unknown.
 * `assertReportableCost` stays as the loud version for
 * [A5](../../tasks/todo.md), but it is no longer the only line of defence.
 */
export function totalCost(costs: Cost[]): CostTotal {
  const models = [...new Set(costs.map((c) => c.model))];
  const unpriced = unpricedModels(costs);

  if (unpriced.length > 0) {
    return { usd: null, basis: "unknown", models, unpriced };
  }

  const usd = costs.reduce((sum, c) => sum + (c.usd ?? 0), 0);
  const basis = costs.some((c) => c.basis === "approximate")
    ? "approximate"
    : "exact";

  return { usd, basis, models, unpriced: [] };
}

/** The same words `describeCost` uses, for a total rather than one call. */
export function describeTotal(total: CostTotal): string {
  if (total.basis === "unknown") {
    return `unpriced(no price for ${total.unpriced.join(", ")} — add to PRICING in lib/llm/cost.ts)`;
  }
  const amount = `$${(total.usd ?? 0).toFixed(6)}`;
  return total.basis === "approximate"
    ? `~${amount} (cached input not discounted)`
    : amount;
}

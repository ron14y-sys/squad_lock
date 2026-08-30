import { describe, expect, it } from "vitest";

import {
  assertReportableCost,
  describeCost,
  describeTotal,
  isPricedModel,
  pendingPriceChanges,
  PRICED_MODELS,
  PRICING,
  priceCall,
  totalCost,
  unpricedModels,
  ZERO_USAGE,
  type TokenUsage,
} from "./cost";

/**
 * [A1](../../tasks/todo.md) has no `Verify` line in the backlog. It gets one
 * here, for the reason [AGENTS.md](../../AGENTS.md) states after #71: a build
 * step nothing exercises yet is not working, it is merely untested.
 *
 * All of this runs without a key, a network or a model. The price table and the
 * arithmetic over it are exactly the part that can be wrong for months without
 * anyone noticing — a wrong dollar figure looks like a dollar figure.
 */

function usage(partial: Partial<TokenUsage>): TokenUsage {
  return { ...ZERO_USAGE, ...partial };
}

describe("the price table", () => {
  it("carries a real price and a read date on every row", () => {
    expect(PRICED_MODELS.length).toBeGreaterThan(0);
    for (const model of PRICED_MODELS) {
      expect(PRICING[model].inputPerM).toBeGreaterThan(0);
      expect(PRICING[model].outputPerM).toBeGreaterThan(0);
      expect(PRICING[model].readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("prices both models the two tasks default to (spec §6.4)", () => {
    expect(isPricedModel("gemini-3.6-flash")).toBe(true);
    expect(isPricedModel("gemini-3.5-flash-lite")).toBe(true);
  });
});

describe("priceCall", () => {
  it("costs nothing when nothing was spent", () => {
    expect(priceCall("gemini-3.6-flash", ZERO_USAGE).usd).toBe(0);
  });

  it("prices input and output at their own rates", () => {
    // 1M input at $0.30 + 1M output at $2.50.
    const spend = usage({ inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(priceCall("gemini-3.5-flash-lite", spend).usd).toBeCloseTo(2.8, 10);
  });

  it("bills thinking at the OUTPUT rate, not the input rate", () => {
    // The trap this file exists for. Thought tokens arrive in their own counter,
    // which makes it easy to price them as input — or to forget them. On a
    // thinking model they are nearly the whole bill: F2 measured 24,299 thought
    // tokens against 1,566 of answer.
    const thinking = priceCall(
      "gemini-3.6-flash",
      usage({ thoughtTokens: 1e6 })
    );
    const answering = priceCall(
      "gemini-3.6-flash",
      usage({ outputTokens: 1e6 })
    );
    const reading = priceCall("gemini-3.6-flash", usage({ inputTokens: 1e6 }));

    expect(thinking.usd).toBeCloseTo(answering.usd!, 10);
    expect(thinking.usd).not.toBeCloseTo(reading.usd!, 10);
  });

  it("prices F2's measured worst run", () => {
    // The `gemini-3.6-flash` / `high` row of docs/decisions/runtime-budget.md:
    // 8045 in / 1566 out / 24299 thought. Real numbers from a real run, so the
    // figure below is what one worst-case matching decision would cost.
    const cost = priceCall(
      "gemini-3.6-flash",
      usage({ inputTokens: 8045, outputTokens: 1566, thoughtTokens: 24299 })
    );
    expect(cost.basis).toBe("exact");
    // ~$0.10 a decision — and ~97% of it is the thinking.
    expect(cost.usd).toBeCloseTo(0.1030275, 7);
  });
});

describe("a model that is not in the table", () => {
  // The behaviour that replaced the old hard block. A model released next week
  // is a model we cannot price, not a model we must refuse to call.

  it("is not priced, and does not pretend to be free", () => {
    const cost = priceCall("gemini-4.0-flash", usage({ inputTokens: 5000 }));
    expect(cost.basis).toBe("unknown");
    // null, never 0 — a zero would average into a total as a real measurement.
    expect(cost.usd).toBeNull();
  });

  it("says so in words, and says where to fix it", () => {
    const line = describeCost(priceCall("gemini-4.0-flash", ZERO_USAGE));
    expect(line).toContain("unpriced");
    expect(line).toContain("gemini-4.0-flash");
    expect(line).toContain("lib/llm/cost.ts");
  });

  it("is named by unpricedModels, once, however many calls it made", () => {
    const costs = [
      priceCall("gemini-3.6-flash", ZERO_USAGE),
      priceCall("gemini-4.0-flash", ZERO_USAGE),
      priceCall("gemini-4.0-flash", ZERO_USAGE),
    ];
    expect(unpricedModels(costs)).toEqual(["gemini-4.0-flash"]);
  });
});

describe("assertReportableCost", () => {
  // The guard, in the one place it belongs: a run may use an unpriced model, a
  // published cost figure may not.

  it("lets a fully priced set of calls be reported", () => {
    const costs = [priceCall("gemini-3.6-flash", usage({ inputTokens: 10 }))];
    expect(() => assertReportableCost(costs)).not.toThrow();
  });

  it("refuses to report a figure that would silently omit a model", () => {
    const costs = [
      priceCall("gemini-3.6-flash", ZERO_USAGE),
      priceCall("gemini-4.0-flash", ZERO_USAGE),
    ];
    expect(() => assertReportableCost(costs)).toThrow(/gemini-4\.0-flash/);
    expect(() => assertReportableCost(costs)).toThrow(/PRICING/);
  });
});

describe("describeCost", () => {
  it("reports an exact figure when no input came from a cache", () => {
    const cost = priceCall(
      "gemini-3.5-flash-lite",
      usage({ inputTokens: 1000, outputTokens: 500 })
    );
    expect(describeCost(cost)).toMatch(/^\$\d\.\d{6}$/);
  });

  it("marks the figure as an over-estimate once a cache is involved", () => {
    // Nothing caches yet. When A8's cycle loop does, cached input reads at 0.1x
    // and this table does not model that — so the number stops being exact, and
    // it has to say so rather than quietly report a wrong one.
    const cost = priceCall(
      "gemini-3.5-flash-lite",
      usage({ inputTokens: 1000, cachedTokens: 800 })
    );
    expect(cost.basis).toBe("approximate");
    expect(describeCost(cost)).toContain("cached input not discounted");
  });
});

describe("pendingPriceChanges", () => {
  /**
   * AGENTS.md: *a comment is not a script.* `gemini-3.6-flash` doubles on
   * 2027-01-01, and that fact used to live in a code comment nothing would ever
   * read. Now the suite fails on the day, naming the row to edit.
   */

  it("is quiet today", () => {
    expect(pendingPriceChanges(new Date())).toEqual([]);
  });

  it("fires the day an announced price change lands", () => {
    const changes = pendingPriceChanges(new Date("2027-01-01"));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toContain("gemini-3.6-flash");
    expect(changes[0]).toContain("7.5");
  });

  it("stays quiet the day before it", () => {
    expect(pendingPriceChanges(new Date("2026-12-31"))).toEqual([]);
  });
});

describe("totalCost", () => {
  /**
   * The guard that does not rely on anyone remembering. Summing `usd` by hand is
   * wrong in a way nothing complains about — `0 + null === 0` — so the natural
   * way to total a run has to be the safe way.
   */

  const priced = (model: string, inputTokens: number) =>
    priceCall(model, usage({ inputTokens }));

  it("adds up calls that are all priced", () => {
    const total = totalCost([
      priced("gemini-3.6-flash", 1_000_000),
      priced("gemini-3.6-flash", 1_000_000),
    ]);
    expect(total.basis).toBe("exact");
    expect(total.usd).toBeCloseTo(1.5, 10);
  });

  it("refuses to produce a number when any part is unpriced", () => {
    const total = totalCost([
      priced("gemini-3.6-flash", 1_000_000),
      priced("gemini-4.0-flash", 1_000_000),
    ]);
    // The hand-written sum would have said $0.75 and looked entirely credible.
    expect(total.usd).toBeNull();
    expect(total.basis).toBe("unknown");
    expect(total.unpriced).toEqual(["gemini-4.0-flash"]);
  });

  it("names the unpriced model in words", () => {
    const total = totalCost([priced("gemini-4.0-flash", 10)]);
    expect(describeTotal(total)).toContain("gemini-4.0-flash");
    expect(describeTotal(total)).not.toContain("$");
  });

  it("carries an approximation upward rather than dropping it", () => {
    const total = totalCost([
      priceCall("gemini-3.6-flash", usage({ inputTokens: 100 })),
      priceCall(
        "gemini-3.6-flash",
        usage({ inputTokens: 100, cachedTokens: 80 })
      ),
    ]);
    expect(total.basis).toBe("approximate");
    expect(describeTotal(total)).toContain("cached input not discounted");
  });

  it("lists every model that contributed", () => {
    const total = totalCost([
      priced("gemini-3.6-flash", 10),
      priced("gemini-3.5-flash-lite", 10),
      priced("gemini-3.6-flash", 10),
    ]);
    expect(total.models).toEqual(["gemini-3.6-flash", "gemini-3.5-flash-lite"]);
  });

  it("totals nothing to zero, not to unknown", () => {
    // An eval run with no calls cost nothing. That is a fact, not a gap.
    expect(totalCost([])).toEqual({
      usd: 0,
      basis: "exact",
      models: [],
      unpriced: [],
    });
  });
});

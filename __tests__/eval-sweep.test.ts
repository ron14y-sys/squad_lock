import { describe, expect, it } from "vitest";

import { loadScenario, scenarioAgentInput } from "@/evals/adapter";
import { countViolations, exitCode, summarize, type Row } from "@/evals/sweep";
import type { MatchOptionDraft, MatchRunDraft } from "@/lib/matching/agent";
import type { Cost } from "@/lib/llm/cost";

/**
 * What a sweep adds up to, tested without a model.
 *
 * The three tests A5's plan promised and the runner shipped without: the
 * violation count, the pass-rate denominator, and a cost nobody could price.
 * Two of those had already been wrong once in a live sweep. Nothing here makes
 * a call.
 */

/* ------------------------------------------------------------ violations */

/**
 * Scenario `01`: Toto violates a participant's hard constraint and A2 drops
 * it; Container survives, at one slot. Both stay in `candidates` — the pool
 * the agent may name — so an illegal answer is expressible, which is exactly
 * what the post-check exists to catch.
 */
function answerOf(placeId: string): MatchRunDraft {
  const input = scenarioAgentInput(loadScenario("hard-constraint-trap"));
  const slot = input.viable[0].slot;

  const option: MatchOptionDraft = {
    rank: 1,
    venue: {
      placeId,
      name: placeId,
      address: null,
      location: { lat: 0, lng: 0 },
    },
    proposedDatetime: slot.start,
    proposedEnd: slot.end,
    participantJustifications: {},
    tradeoffs: {},
    unverified: [],
  };

  return {
    meetingId: "eval-hard-constraint-trap",
    cycleNumber: 1,
    shortlist: [],
    options: [option],
  } as MatchRunDraft;
}

describe("countViolations", () => {
  const input = scenarioAgentInput(loadScenario("hard-constraint-trap"));

  it("the fixture is what these tests assume", () => {
    expect(input.candidates.map((c) => c.placeId)).toContain("place-01-toto");
    expect(input.viable.map((pair) => pair.candidatePlaceId)).toEqual([
      "place-01-container",
    ]);
  });

  it("counts nothing on the legal answer", () => {
    expect(countViolations(input, answerOf("place-01-container"))).toBe(0);
  });

  it("counts a venue that breaks a hard constraint", () => {
    expect(countViolations(input, answerOf("place-01-toto"))).toBeGreaterThan(
      0
    );
  });

  it("counts a venue that was never a candidate", () => {
    expect(countViolations(input, answerOf("place-nowhere"))).toBe(1);
  });
});

/* ---------------------------------------------------------------- totals */

const scenario = loadScenario("hard-constraint-trap");
const priced: Cost = { model: "gemini-3.6-flash", usd: 0.002, basis: "exact" };

function row(overrides: Partial<Row>): Row {
  return { scenario, state: "pass", detail: "", violations: 0, ...overrides };
}

describe("summarize", () => {
  it("divides by scenarios that answered, not by those that errored first", () => {
    // The run that printed "4 scored · 1 passed (25%)": one answer came back
    // and passed, three calls were refused before any answer arrived.
    const refused = row({ state: "error", detail: "high demand" });
    const total = summarize([
      row({ state: "pass", cost: priced, ms: 6_000 }),
      refused,
      refused,
      refused,
    ]);

    expect(total.scored).toBe(1);
    expect(total.passed).toBe(1);
    expect(total.rate).toBe(100);
    expect(total.unreached).toBe(3);
  });

  it("keeps a failed answer in the denominator", () => {
    const total = summarize([
      row({ state: "pass", cost: priced, ms: 1 }),
      row({ state: "fail", cost: priced, ms: 1 }),
    ]);
    expect(total.rate).toBe(50);
  });

  it("does not count blocked or deferred scenarios as scored", () => {
    const total = summarize([
      row({ state: "pass", cost: priced, ms: 1 }),
      row({ state: "blocked" }),
      row({ state: "deferred" }),
    ]);
    expect(total.scored).toBe(1);
    expect(total.blocked).toBe(1);
    expect(total.deferred).toBe(1);
  });

  it("leaves an unpriced call unpriced rather than turning it into $0", () => {
    const unpriced: Cost = {
      model: "not-a-model",
      usd: null,
      basis: "unknown",
    };
    const total = summarize([
      row({ cost: priced, ms: 1 }),
      row({ cost: unpriced, ms: 1 }),
    ]);

    expect(total.cost?.usd).toBeNull();
    expect(total.cost?.basis).toBe("unknown");
  });

  it("reports no cost at all when no call was made", () => {
    expect(summarize([row({ state: "blocked" })]).cost).toBeNull();
  });
});

describe("exitCode", () => {
  it("is zero when answers are wrong but legal — never on the pass rate", () => {
    expect(exitCode([row({ state: "fail", cost: priced })])).toBe(0);
  });

  it("is non-zero on a hard-constraint violation", () => {
    expect(
      exitCode([row({ state: "pass", cost: priced, violations: 1 })])
    ).toBe(1);
  });

  it("is non-zero on an error", () => {
    expect(exitCode([row({ state: "error" })])).toBe(1);
  });
});

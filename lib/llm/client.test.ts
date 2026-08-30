import { describe, expect, it } from "vitest";

import {
  formatCallRecord,
  isKnownThinkingLevel,
  isRateLimited,
  LlmTruncatedError,
  MAX_OUTPUT_TOKENS,
  resolveConfig,
  retryDelayMs,
  type LlmCallRecord,
} from "./client";

/**
 * No key, no network, no model. What is tested here is the part of A1 that can
 * be wrong without the API ever complaining: which model a task resolves to,
 * what happens to a bad value, and whether a truncated response is reported as
 * a truncation.
 *
 * The call itself is measured rather than unit-tested — that is what
 * [F2](../../docs/decisions/runtime-budget.md) did and what
 * [A5](../../tasks/todo.md) will keep doing.
 */

describe("resolveConfig", () => {
  it("maps each task to the model spec §6.4 assigns it", () => {
    expect(resolveConfig("matching", {}).model).toBe("gemini-3.6-flash");
    expect(resolveConfig("extraction", {}).model).toBe("gemini-3.5-flash-lite");
  });

  it("runs routine matching at thinking level low", () => {
    expect(resolveConfig("matching", {}).thinkingLevel).toBe("low");
  });

  it("streams matching and does not stream extraction", () => {
    // Streaming inside the request is the architecture F2 tested (spec §4.1e).
    // Extraction returns one small object; there is nothing to stream to.
    expect(resolveConfig("matching", {}).stream).toBe(true);
    expect(resolveConfig("extraction", {}).stream).toBe(false);
  });

  it("keeps the matching deadline under Vercel's 300s function limit", () => {
    // Just under, so what stops a run is the platform limit the budget was
    // measured against — not a client timeout we invented. At 180s this cut off
    // a real 207.8s run and recorded the cap as the worst case.
    const { timeoutMs } = resolveConfig("matching", {});
    expect(timeoutMs).toBeLessThan(300_000);
    expect(timeoutMs).toBeGreaterThan(207_800);
  });

  it("takes the model from the environment", () => {
    const config = resolveConfig("matching", {
      GEMINI_MATCHING_MODEL: "gemini-3.5-flash-lite",
      GEMINI_MATCHING_THINKING: "high",
    });
    expect(config.model).toBe("gemini-3.5-flash-lite");
    expect(config.thinkingLevel).toBe("high");
  });

  it("reads each task's own variables and not the other's", () => {
    const env = { GEMINI_MATCHING_MODEL: "gemini-3.5-flash" };
    expect(resolveConfig("matching", env).model).toBe("gemini-3.5-flash");
    expect(resolveConfig("extraction", env).model).toBe(
      "gemini-3.5-flash-lite"
    );
  });

  it("accepts a model it has never heard of", () => {
    // The point of the change. A model released next week is not our decision to
    // block — Google is the authority on what exists, and it changes the answer
    // without telling us. The cost of not knowing its price is one log line.
    const config = resolveConfig("matching", {
      GEMINI_MATCHING_MODEL: "gemini-4.0-flash",
    });
    expect(config.model).toBe("gemini-4.0-flash");
  });

  it("accepts a thinking level it has never heard of", () => {
    // Google's own SDK type ends in `(string & {})` — any string is valid.
    const config = resolveConfig("matching", {
      GEMINI_MATCHING_THINKING: "extreme",
    });
    expect(config.thinkingLevel).toBe("extreme");
    // Not blocked, but not silent either: the log line flags it, because an
    // unrecognised level may be ignored and served at the default instead.
    expect(isKnownThinkingLevel("extreme")).toBe(false);
    expect(isKnownThinkingLevel("high")).toBe(true);
  });

  it("ignores a variable that is set but empty", () => {
    const config = resolveConfig("matching", {
      GEMINI_MATCHING_MODEL: "  ",
      GEMINI_MATCHING_THINKING: "",
    });
    expect(config.model).toBe("gemini-3.6-flash");
    expect(config.thinkingLevel).toBe("low");
  });
});

describe("the output budget", () => {
  it("is sized for the thinking as well as the answer", () => {
    // 16,000 truncated a response mid-object during F2, because one run spent
    // 24,299 thought tokens from this same budget.
    expect(MAX_OUTPUT_TOKENS).toBeGreaterThan(24_299 + 1_566);
  });
});

describe("LlmTruncatedError", () => {
  it("says truncated, not malformed, and points at the cap", () => {
    // The whole reason this has its own type: JSON.parse blames the fragment,
    // and the fragment is the symptom, not the cause.
    const error = new LlmTruncatedError({
      model: "gemini-3.6-flash",
      task: "matching",
      status: "incomplete",
      chars: 2500,
    });
    expect(error.message).toContain("truncated");
    expect(error.message).toContain("max_output_tokens");
    expect(error.rateLimited).toBe(false);
  });
});

describe("isRateLimited", () => {
  it("recognises the quota wall in the API's own wording", () => {
    expect(isRateLimited("429 RESOURCE_EXHAUSTED: quota exceeded")).toBe(true);
    expect(isRateLimited("Quota exceeded for GenerateRequestsPerDay")).toBe(
      true
    );
  });

  it("does not mistake an ordinary failure for one", () => {
    expect(isRateLimited("socket hang up")).toBe(false);
    expect(isRateLimited("500 internal error")).toBe(false);
  });
});

describe("retryDelayMs", () => {
  it("takes the API's own number when it gives one", () => {
    expect(retryDelayMs("Please retry in 27.5s")).toBe(27_500);
  });

  it("returns nothing to guess from when it does not", () => {
    expect(retryDelayMs("quota exceeded")).toBeNull();
  });
});

describe("formatCallRecord", () => {
  const record: LlmCallRecord = {
    task: "matching",
    model: "gemini-3.6-flash",
    thinkingLevel: "low",
    ms: 4712,
    msToFirstText: 903,
    usage: {
      inputTokens: 8045,
      outputTokens: 1566,
      thoughtTokens: 24299,
      cachedTokens: 0,
    },
    cost: { model: "gemini-3.6-flash", usd: 0.1030275, basis: "exact" },
  };

  it("logs all three token counters and the cost on one greppable line", () => {
    const line = formatCallRecord(record);
    expect(line).toContain("in=8045");
    expect(line).toContain("out=1566");
    expect(line).toContain("thought=24299");
    expect(line).toContain("cost=$0.103");
  });

  it("omits the cache field while nothing caches", () => {
    expect(formatCallRecord(record)).not.toContain("cached=");
  });

  it("says unpriced rather than printing a dollar sign it cannot back", () => {
    const line = formatCallRecord({
      ...record,
      model: "gemini-4.0-flash",
      cost: { model: "gemini-4.0-flash", usd: null, basis: "unknown" },
    });
    expect(line).toContain("cost=unpriced(gemini-4.0-flash");
    expect(line).not.toContain("cost=$");
  });

  it("flags a thinking level the API may not recognise", () => {
    const line = formatCallRecord({ ...record, thinkingLevel: "extreme" });
    expect(line).toContain("thinking=extreme");
    expect(line).toContain("thinking_level_unrecognised=true");
    expect(formatCallRecord(record)).not.toContain("unrecognised");
  });

  it("drops time-to-first-text on a call that did not stream", () => {
    const line = formatCallRecord({ ...record, msToFirstText: null });
    expect(line).not.toContain("ms_first_text");
  });
});

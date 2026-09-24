import { describe, expect, it } from "vitest";

import { LlmCallError, LlmTruncatedError } from "@/lib/llm/client";

import {
  buildPayload,
  ConstraintUpdateError,
  failureOutcome,
  interpretUpdate,
  runConstraintUpdater,
  type ConstraintUpdateInput,
} from "./constraint-updater";

/**
 * Every answer below is written by hand, and the ones a model should never
 * produce are the point: [spec §9](../../docs/spec.md) tests an LLM layer at
 * its guard rails, not at the model. No key, no quota, no network.
 *
 * Whether the model extracts the *right* constraint is a different question
 * with a different answer — the eval fixtures, in A7's step 6.
 */

const input: ConstraintUpdateInput = {
  reasonText: "רועש לי מדי שם, הייתי מעדיפה משהו שקט",
  rejected: {
    venueName: "Beer Bazaar",
    neighbourhood: "Florentin",
    venueIs: { noiseLevel: "lively" },
    slot: {
      start: new Date("2026-09-12T18:00:00.000Z"),
      end: new Date("2026-09-12T21:00:00.000Z"),
    },
  },
};

describe("interpretUpdate", () => {
  it("reads a stated preference and the objection together", () => {
    expect(
      interpretUpdate(
        JSON.stringify({
          soft_preferences: { noiseLevel: "quiet" },
          objection: "soft",
        })
      )
    ).toEqual({ softPreferences: { noiseLevel: "quiet" }, objection: "soft" });
  });

  // "Nothing mapped" is an answer, not a failure — it is what makes A8 able to
  // say so rather than inventing a reason (plan decision 2).
  it.each(["none", "distance", "time", "venue_identity"] as const)(
    "accepts %s with nothing stated",
    (objection) => {
      expect(
        interpretUpdate(JSON.stringify({ soft_preferences: {}, objection }))
          .objection
      ).toBe(objection);
    }
  );

  it("treats an omitted soft_preferences as an empty one", () => {
    expect(
      interpretUpdate(JSON.stringify({ objection: "none" })).softPreferences
    ).toEqual({});
  });

  it.each([
    [
      "a field outside the vocabulary",
      { soft_preferences: { seating: "outdoor" }, objection: "soft" },
    ],
    [
      "a value outside the vocabulary",
      { soft_preferences: { noiseLevel: "silent" }, objection: "soft" },
    ],
    [
      "an objection outside the vocabulary",
      { soft_preferences: {}, objection: "too_far" },
    ],
    [
      "a preference filed under another kind of objection",
      { soft_preferences: { budget: "modest" }, objection: "distance" },
    ],
    ["soft with nothing stated", { soft_preferences: {}, objection: "soft" }],
  ])("rejects %s", (_case, answer) => {
    expect(() => interpretUpdate(JSON.stringify(answer))).toThrow(
      ConstraintUpdateError
    );
  });

  it("names truncation as the likely cause when the text is not JSON", () => {
    expect(() => interpretUpdate('{"objection": "no')).toThrow(/truncated/);
  });
});

describe("buildPayload", () => {
  it("carries the rejected option and the person's own words", () => {
    const payload = buildPayload(input);

    expect(payload).toContain("Beer Bazaar");
    expect(payload).toContain("Florentin");
    expect(payload).toContain('"noiseLevel": "lively"');
    expect(payload).toContain(input.reasonText);
  });
});

describe("runConstraintUpdater", () => {
  it("refuses a rejection with no text rather than spending a call", async () => {
    await expect(
      runConstraintUpdater({ ...input, reasonText: "   " })
    ).rejects.toThrow(ConstraintUpdateError);
  });
});

describe("failureOutcome", () => {
  const context = {
    model: "gemini-3.5-flash-lite",
    task: "extraction" as const,
  };

  it("separates the quota wall from a call that did not come back", () => {
    expect(
      failureOutcome(new LlmCallError("429", { ...context, rateLimited: true }))
    ).toBe("failed_quota");

    expect(failureOutcome(new LlmCallError("socket hang up", context))).toBe(
      "failed_call"
    );
  });

  // LlmTruncatedError extends LlmCallError, so order matters: a cut-off
  // answer recorded as an unreachable model points the next person at the
  // network instead of at the output cap.
  it("reads a cut-off answer and a rejected one as the same unusable answer", () => {
    expect(
      failureOutcome(
        new LlmTruncatedError({ ...context, status: "incomplete", chars: 40 })
      )
    ).toBe("failed_invalid");

    expect(failureOutcome(new ConstraintUpdateError("budget: invalid"))).toBe(
      "failed_invalid"
    );
  });

  it("treats anything it does not recognise as a failed call", () => {
    expect(failureOutcome(new Error("who knows"))).toBe("failed_call");
  });
});

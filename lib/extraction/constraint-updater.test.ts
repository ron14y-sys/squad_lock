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
  reasonText: "יקר לי מדי שם, הייתי מעדיפה בר",
  rejected: {
    venueName: "Beer Bazaar",
    neighbourhood: "Florentin",
    venueIs: { budget: "splurge" },
    slot: {
      start: new Date("2026-09-12T18:00:00.000Z"),
      end: new Date("2026-09-12T21:00:00.000Z"),
    },
  },
};

describe("interpretUpdate", () => {
  const read = (answer: unknown) => interpretUpdate(JSON.stringify(answer));

  it("reads what they want, with nothing else set", () => {
    expect(
      read({
        soft_preferences: { venueKinds: ["bar"], budget: "modest" },
        not_this_place: false,
      })
    ).toEqual({
      softPreferences: { venueKinds: ["bar"], budget: "modest" },
      distance: null,
      start: null,
      notThisPlace: false,
      untranslated: null,
      objection: "soft",
    });
  });

  // #217: "I want a bar" had nowhere to land; now it is a field.
  it("reads a kind of place and a cuisine", () => {
    expect(
      read({ soft_preferences: { venueKinds: ["bar"], cuisines: ["sushi"] } })
        .softPreferences
    ).toEqual({ venueKinds: ["bar"], cuisines: ["sushi"] });
  });

  // #220: what to avoid is a correction too.
  it("reads what they want to avoid into the same correction", () => {
    expect(
      read({ avoid: { cuisines: ["asian"], venueKinds: ["bar"] } })
    ).toMatchObject({
      softPreferences: { avoidCuisines: ["asian"], avoidVenueKinds: ["bar"] },
      objection: "soft",
    });
  });

  it("reads 'too far' as a direction, and a distance they wrote as a number that wins", () => {
    expect(read({ distance: { closer: true } }).distance).toEqual({
      kind: "closer",
    });
    expect(read({ distance: { closer: true, max_km: 2 } }).distance).toEqual({
      kind: "max_km",
      km: 2,
    });
  });

  it("reads 'too late' as a direction, and a time they wrote as a bound that wins", () => {
    expect(read({ start: { direction: "earlier" } }).start).toEqual({
      direction: "earlier",
    });
    expect(
      read({ start: { direction: "later", not_before: "20:00" } }).start
    ).toEqual({ notBefore: "20:00" });
  });

  // One rejection, several facts — the case a single label could not hold.
  it("keeps every fact of one rejection", () => {
    const update = read({
      soft_preferences: { venueKinds: ["bar"] },
      distance: { closer: true },
      untranslated: "רוצה חניה",
    });

    expect(update.softPreferences).toEqual({ venueKinds: ["bar"] });
    expect(update.distance).toEqual({ kind: "closer" });
    expect(update.untranslated).toBe("רוצה חניה");
  });

  // The label is derived by code from what came back, never chosen.
  it.each([
    [{ not_this_place: true, distance: { closer: true } }, "venue_identity"],
    [
      { soft_preferences: { cuisines: ["sushi"] }, not_this_place: true },
      "soft",
    ],
    [
      { soft_preferences: { budget: "modest" }, distance: { closer: true } },
      "soft",
    ],
    [
      { distance: { closer: true }, start: { direction: "earlier" } },
      "distance",
    ],
    [{ start: { not_after: "21:00" } }, "time"],
    [{ untranslated: "חניה" }, "none"],
    [{}, "none"],
  ] as const)("labels %j as %s", (answer, objection) => {
    expect(read(answer).objection).toBe(objection);
  });

  it.each([
    [
      "a field outside the vocabulary",
      { soft_preferences: { seating: "outdoor" } },
    ],
    [
      "a value outside the vocabulary",
      { soft_preferences: { cuisines: ["french"] } },
    ],
    [
      "a field the old vocabulary had (#217)",
      { soft_preferences: { noiseLevel: "quiet" } },
    ],
    [
      "an empty list — 'doesn't matter' leaves the field out",
      { soft_preferences: { venueKinds: [] } },
    ],
    ["a time that is not HH:MM", { start: { not_before: "8pm" } }],
    ["a distance no city meeting means", { distance: { max_km: 400 } }],
    ["a label the model was not asked for", { objection: "soft" }],
  ])("rejects %s", (_case, answer) => {
    expect(() => read(answer)).toThrow(ConstraintUpdateError);
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
    expect(payload).toContain('"budget": "splurge"');
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

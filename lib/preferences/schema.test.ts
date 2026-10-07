import { describe, expect, it } from "vitest";

import { preferenceProfileInputSchema } from "./schema";

describe("preferenceProfileInputSchema", () => {
  it("accepts an empty object — every field is an independent partial update", () => {
    expect(preferenceProfileInputSchema.safeParse({}).success).toBe(true);
  });

  it("accepts just one field, e.g. a tolerance slider on its own", () => {
    const result = preferenceProfileInputSchema.safeParse({
      toleranceKm: 12.5,
    });

    expect(result.success).toBe(true);
  });

  it("accepts a full profile shaped like the this-or-that game's output", () => {
    const result = preferenceProfileInputSchema.safeParse({
      hardConstraints: {
        dietary: ["kosher"],
        allergies: ["peanuts"],
        unavailable: [{ weekdays: ["friday"], from: "18:00", to: "23:00" }],
      },
      softPreferences: {
        budget: "modest",
        venueKinds: ["bar", "cafe"],
        cuisines: ["italian", "sushi"],
      },
      home: { lat: 32.08, lng: 34.78 },
      homeNeighbourhood: "Florentin",
      toleranceKm: 5,
      recurringMobilityRules: [
        { kind: "mode_unavailable", weekdays: ["friday"], mode: "car" },
        {
          kind: "origin_override",
          weekdays: ["tuesday"],
          originLabel: "work",
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("accepts a partial soft-preference set — a declined question stores nothing for that field (#86)", () => {
    const result = preferenceProfileInputSchema.safeParse({
      softPreferences: { venueKinds: ["bar"] },
    });

    expect(result.success).toBe(true);
  });

  it.each([
    ["a budget outside the vocabulary", { budget: "moderate" }],
    ["a kind of place outside the vocabulary", { venueKinds: ["club"] }],
    ["a cuisine outside the approved list", { cuisines: ["french"] }],
    ["an empty list — 'doesn't matter' leaves the field out", { cuisines: [] }],
  ])("rejects %s", (_case, softPreferences) => {
    expect(
      preferenceProfileInputSchema.safeParse({ softPreferences }).success
    ).toBe(false);
  });

  // #217: a game page loaded before the vocabulary changed still sends
  // `noiseLevel`. Its other answers must still save, and the old key must not.
  it("drops a key from the old vocabulary instead of refusing the save", () => {
    const result = preferenceProfileInputSchema.safeParse({
      softPreferences: { noiseLevel: "quiet", budget: "modest" },
    });

    expect(result.success).toBe(true);
    expect(result.data?.softPreferences).toEqual({ budget: "modest" });
  });

  it("rejects a local time outside HH:MM 24-hour", () => {
    const result = preferenceProfileInputSchema.safeParse({
      hardConstraints: {
        dietary: [],
        allergies: [],
        unavailable: [{ weekdays: [], from: "6:00 PM", to: "23:00" }],
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects a recurring mobility rule with a kind the union doesn't have", () => {
    const result = preferenceProfileInputSchema.safeParse({
      recurringMobilityRules: [{ kind: "no_car_ever", weekdays: [] }],
    });

    expect(result.success).toBe(false);
  });

  it("rejects an unknown top-level field rather than silently dropping it", () => {
    // .strict() — a typo or an old client field should surface as a 400, not
    // disappear into an upsert that looks like it worked.
    const result = preferenceProfileInputSchema.safeParse({
      toleranceKm: 5,
      toleranceMiles: 3,
    });

    expect(result.success).toBe(false);
  });

  it("rejects a latitude out of range", () => {
    const result = preferenceProfileInputSchema.safeParse({
      home: { lat: 200, lng: 34.78 },
    });

    expect(result.success).toBe(false);
  });

  it("rejects a negative tolerance", () => {
    const result = preferenceProfileInputSchema.safeParse({
      toleranceKm: -1,
    });

    expect(result.success).toBe(false);
  });

  it("rejects a neighbourhood name sent without its coordinates (#132)", () => {
    const result = preferenceProfileInputSchema.safeParse({
      homeNeighbourhood: "Florentin",
    });

    expect(result.success).toBe(false);
  });

  it("accepts coordinates on their own — a partial update can move the point", () => {
    const result = preferenceProfileInputSchema.safeParse({
      home: { lat: 32.08, lng: 34.78 },
    });

    expect(result.success).toBe(true);
  });
});

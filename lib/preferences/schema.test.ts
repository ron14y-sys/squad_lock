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
        noiseLevel: "quiet",
        activityStyle: "cultural",
        budget: "modest",
        cuisine: "familiar",
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

  it("rejects a soft preference value outside the this-or-that game's four levers", () => {
    const result = preferenceProfileInputSchema.safeParse({
      softPreferences: {
        noiseLevel: "moderate", // not one of "lively" | "quiet"
        activityStyle: "cultural",
        budget: "modest",
        cuisine: "familiar",
      },
    });

    expect(result.success).toBe(false);
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
});

import { describe, expect, it } from "vitest";

import { initiateMeetingSchema, respondToMeetingSchema } from "./schema";

describe("initiateMeetingSchema", () => {
  it("accepts a fully blank body — the default path, not a degraded one", () => {
    expect(initiateMeetingSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a single field on its own", () => {
    expect(
      initiateMeetingSchema.safeParse({ venue: "Cafe Nona" }).success
    ).toBe(true);
  });

  it("accepts a fully filled body", () => {
    const result = initiateMeetingSchema.safeParse({
      date: "2026-09-10",
      part: "evening",
      venue: "Cafe Nona",
      occasion: "Ron's birthday",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a date in the wrong shape", () => {
    expect(
      initiateMeetingSchema.safeParse({ date: "10/09/2026" }).success
    ).toBe(false);
  });

  it("rejects a part outside morning/midday/evening", () => {
    expect(initiateMeetingSchema.safeParse({ part: "night" }).success).toBe(
      false
    );
  });

  it("accepts a part with no date (#168) — 'evening, any day this week'", () => {
    expect(initiateMeetingSchema.safeParse({ part: "evening" }).success).toBe(
      true
    );
  });

  it("accepts a date with no part", () => {
    expect(
      initiateMeetingSchema.safeParse({ date: "2026-09-10" }).success
    ).toBe(true);
  });

  it("rejects a venue that is only whitespace", () => {
    expect(initiateMeetingSchema.safeParse({ venue: "   " }).success).toBe(
      false
    );
  });

  it("rejects an unknown top-level field", () => {
    const result = initiateMeetingSchema.safeParse({
      venue: "Cafe Nona",
      guestOfHonor: "Ron",
    });

    expect(result.success).toBe(false);
  });
});

describe("respondToMeetingSchema", () => {
  it("accepts a bare approve", () => {
    expect(respondToMeetingSchema.safeParse({ kind: "approve" }).success).toBe(
      true
    );
  });

  it("accepts a bare cant_make_it", () => {
    expect(
      respondToMeetingSchema.safeParse({ kind: "cant_make_it" }).success
    ).toBe(true);
  });

  it("rejects approve with an unexpected field", () => {
    const result = respondToMeetingSchema.safeParse({
      kind: "approve",
      reasonText: "not needed here",
    });

    expect(result.success).toBe(false);
  });

  it("accepts doesnt_suit with reason text", () => {
    const result = respondToMeetingSchema.safeParse({
      kind: "doesnt_suit",
      reasonText: "Too far from the office on a weeknight.",
    });

    expect(result.success).toBe(true);
  });

  it("rejects doesnt_suit with no reason text", () => {
    expect(
      respondToMeetingSchema.safeParse({ kind: "doesnt_suit" }).success
    ).toBe(false);
  });

  it("rejects doesnt_suit with whitespace-only reason text", () => {
    expect(
      respondToMeetingSchema.safeParse({
        kind: "doesnt_suit",
        reasonText: "   ",
      }).success
    ).toBe(false);
  });

  it("accepts an amendment with just a note", () => {
    const result = respondToMeetingSchema.safeParse({
      kind: "amendment",
      note: "No car tonight.",
    });

    expect(result.success).toBe(true);
  });

  it("accepts an amendment with an origin override and mobility windows", () => {
    const result = respondToMeetingSchema.safeParse({
      kind: "amendment",
      origin: { lat: 32.08, lng: 34.78 },
      originLabel: "Coming from work",
      mobilityWindows: [
        {
          mode: "car",
          available: false,
          window: { weekdays: [], from: "18:00", to: "21:00" },
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  // #220: the fields #222/#223's form will send.
  it("accepts an amendment with only tonight's distance or start bounds", () => {
    for (const fields of [
      { toleranceKm: 2 },
      { earliestStart: "20:00" },
      { latestStart: "21:30" },
    ]) {
      expect(
        respondToMeetingSchema.safeParse({ kind: "amendment", ...fields })
          .success
      ).toBe(true);
    }
  });

  it("refuses a start bound that is not HH:MM, or a distance out of range", () => {
    for (const fields of [
      { earliestStart: "8pm" },
      { latestStart: "25:00" },
      { toleranceKm: 0 },
      { toleranceKm: 400 },
    ]) {
      expect(
        respondToMeetingSchema.safeParse({ kind: "amendment", ...fields })
          .success
      ).toBe(false);
    }
  });

  it("rejects a fully empty amendment — it would correct nothing", () => {
    expect(
      respondToMeetingSchema.safeParse({ kind: "amendment" }).success
    ).toBe(false);
  });

  it("rejects an amendment with an empty mobilityWindows array and nothing else", () => {
    expect(
      respondToMeetingSchema.safeParse({
        kind: "amendment",
        mobilityWindows: [],
      }).success
    ).toBe(false);
  });

  it("rejects an unknown kind", () => {
    expect(respondToMeetingSchema.safeParse({ kind: "shrug" }).success).toBe(
      false
    );
  });

  it("rejects a missing kind", () => {
    expect(respondToMeetingSchema.safeParse({}).success).toBe(false);
  });
});

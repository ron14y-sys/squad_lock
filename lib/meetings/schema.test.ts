import { describe, expect, it } from "vitest";

import { initiateMeetingSchema } from "./schema";

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
      time: "19:30",
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

  it("rejects a time in the wrong shape", () => {
    expect(initiateMeetingSchema.safeParse({ time: "7:30pm" }).success).toBe(
      false
    );
  });

  it("rejects a time with no date — it would schedule nothing", () => {
    expect(initiateMeetingSchema.safeParse({ time: "19:30" }).success).toBe(
      false
    );
  });

  it("accepts a date with no time", () => {
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

import { describe, expect, it } from "vitest";

import {
  CLOSER_FACTOR,
  MIN_TOLERANCE_KM,
  startBoundsFor,
  toleranceFor,
} from "./tonight-bounds";

describe("toleranceFor", () => {
  it("is nothing when distance was not mentioned", () => {
    expect(toleranceFor(null, { distanceKm: 4, currentKm: 8 })).toBeNull();
  });

  it("takes a distance the person wrote as it is", () => {
    expect(
      toleranceFor({ kind: "max_km", km: 2 }, { distanceKm: 4, currentKm: 8 })
    ).toBe(2);
  });

  it("turns 'closer' into less than the rejected venue's distance", () => {
    // The venue was 4 km away, inside an 8 km tolerance: next time, 3.2 km.
    expect(
      toleranceFor({ kind: "closer" }, { distanceKm: 4, currentKm: 8 })
    ).toBe(4 * CLOSER_FACTOR);
  });

  it("still tightens when the venue was already beyond the tolerance", () => {
    expect(
      toleranceFor({ kind: "closer" }, { distanceKm: 10, currentKm: 5 })
    ).toBe(5 * CLOSER_FACTOR);
  });

  it("never goes below a floor that still means something in a city", () => {
    expect(
      toleranceFor({ kind: "closer" }, { distanceKm: 0.2, currentKm: 5 })
    ).toBe(MIN_TOLERANCE_KM);
  });

  it("is nothing when there is nothing to measure from", () => {
    expect(
      toleranceFor({ kind: "closer" }, { distanceKm: null, currentKm: 5 })
    ).toBeNull();
  });
});

describe("startBoundsFor", () => {
  // 21:00 in Israel on a September evening (UTC+3).
  const rejected = new Date("2026-09-12T18:00:00.000Z");

  it("is nothing when time was not mentioned", () => {
    expect(startBoundsFor(null, rejected)).toEqual({
      earliestStart: null,
      latestStart: null,
    });
  });

  it("turns 'too late' into a latest start half an hour before the rejected one", () => {
    expect(startBoundsFor({ direction: "earlier" }, rejected)).toEqual({
      earliestStart: null,
      latestStart: "20:30",
    });
  });

  it("turns 'too early' into an earliest start half an hour after it", () => {
    expect(startBoundsFor({ direction: "later" }, rejected)).toEqual({
      earliestStart: "21:30",
      latestStart: null,
    });
  });

  it("takes times the person wrote as they are", () => {
    expect(
      startBoundsFor({ notBefore: "20:00", notAfter: "22:00" }, rejected)
    ).toEqual({ earliestStart: "20:00", latestStart: "22:00" });
  });
});

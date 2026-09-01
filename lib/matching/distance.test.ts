import { describe, expect, it } from "vitest";

import type { LatLng } from "@/lib/types";
import {
  assertToleranceKm,
  BurdenError,
  burdenValue,
  clampDetourFactor,
  straightLineKm,
} from "./distance";

/**
 * Real places, because a distance test that invents its coordinates can only
 * ever check the formula against itself. These two are far enough apart to be
 * worth measuring and well-known enough to be checked against any map.
 */
const ROTHSCHILD: LatLng = { lat: 32.0648, lng: 34.7749 };
const JERUSALEM: LatLng = { lat: 31.7683, lng: 35.2137 };

describe("straight-line distance", () => {
  it("puts a degree of latitude at 111.19 km, at the equator and at 60 north", () => {
    // A meridian is a great circle whatever the longitude, so this is an exact
    // oracle for the radius and the formula together — no map required.
    const atEquator = straightLineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    const atSixty = straightLineKm({ lat: 60, lng: 25 }, { lat: 61, lng: 25 });

    expect(atEquator).toBeCloseTo(111.195, 2);
    expect(atSixty).toBeCloseTo(111.195, 2);
  });

  it("puts Rothschild about 53 km from central Jerusalem", () => {
    // The sanity check the sphere oracle above cannot give: a real pair of
    // places, at the latitude this project actually runs at. Roughly 33 km
    // north-south and 41 km east-west, so a shade under 53 km on the
    // diagonal — which is the straight line, and about 20 km less than the
    // drive. The gap between those two numbers is the reason §5.4 forbids
    // calling any of this travel time.
    expect(straightLineKm(ROTHSCHILD, JERUSALEM)).toBeGreaterThan(52.5);
    expect(straightLineKm(ROTHSCHILD, JERUSALEM)).toBeLessThan(53.5);
  });

  it("is zero between a point and itself, and the same in both directions", () => {
    expect(straightLineKm(ROTHSCHILD, ROTHSCHILD)).toBe(0);
    expect(straightLineKm(ROTHSCHILD, JERUSALEM)).toBeCloseTo(
      straightLineKm(JERUSALEM, ROTHSCHILD),
      12
    );
  });

  it("does not round, so two venues thirty metres apart do not tie", () => {
    // `lib/spike/payload.ts` rounds to 100 m for readability. Doing that here
    // would manufacture exact ties, and resolving past a tie is what leximin
    // is for — so the two functions stay separate on purpose.
    const near = straightLineKm(ROTHSCHILD, { lat: 32.0648, lng: 34.7752 });
    const nearer = straightLineKm(ROTHSCHILD, { lat: 32.0648, lng: 34.7751 });

    expect(near).toBeGreaterThan(nearer);
    expect(near).toBeLessThan(0.1);
  });

  it("refuses a coordinate that is not a point on Earth", () => {
    // A NaN burden does not fail, it randomises: `NaN < x` and `NaN > x` are
    // both false, so a bad coordinate would silently scramble the ranking.
    const cases: LatLng[] = [
      { lat: 91, lng: 34 },
      { lat: -91, lng: 34 },
      { lat: 32, lng: 200 },
      { lat: Number.NaN, lng: 34 },
      { lat: 32, lng: Number.POSITIVE_INFINITY },
    ];

    for (const bad of cases) {
      expect(() => straightLineKm(ROTHSCHILD, bad)).toThrow(BurdenError);
    }
  });

  it("says which end of the journey was the bad one", () => {
    expect(() => straightLineKm({ lat: 91, lng: 0 }, ROTHSCHILD)).toThrow(
      /the origin/
    );
    expect(() => straightLineKm(ROTHSCHILD, { lat: 91, lng: 0 })).toThrow(
      /the destination/
    );
  });
});

describe("the burden formula", () => {
  it("is exactly 1.0 at the distance the person said they were comfortable with", () => {
    // The whole meaning of the number (spec §5.4). 8 km for someone whose
    // stated tolerance is 8 km is precisely their limit, and reads as 1.0.
    expect(burdenValue(8, 1, 8)).toBe(1);
    expect(burdenValue(4, 1, 8)).toBe(0.5);
    expect(burdenValue(12, 1, 8)).toBe(1.5);
  });

  it("scales linearly with the detour factor", () => {
    // The correction A12 will supply: two neighbourhoods a river apart are
    // further in practice than the straight line between them (spec §5.4).
    expect(burdenValue(8, 1.5, 8)).toBe(1.5);
    expect(burdenValue(8, 2, 8)).toBe(2);
  });

  it("clamps a detour factor below 1.0 back up to the straight line", () => {
    // A journey shorter than the straight line between its ends is not a
    // thing. `lib/types/matching.ts` already says a model returning one is
    // wrong; this is where that is enforced.
    expect(clampDetourFactor(0.8)).toBe(1);
    expect(clampDetourFactor(-2)).toBe(1);
    expect(clampDetourFactor(0)).toBe(1);
    expect(burdenValue(8, 0.5, 8)).toBe(1);
  });

  it("treats a detour factor that is missing or nonsense as no correction at all", () => {
    // A correction can be dropped and leave a valid answer behind. This is
    // the half of the asymmetry with `assertToleranceKm` below.
    expect(clampDetourFactor(undefined)).toBe(1);
    expect(clampDetourFactor(Number.NaN)).toBe(1);
    expect(clampDetourFactor(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("keeps a detour factor of 1.0 or more exactly as it was given", () => {
    expect(clampDetourFactor(1)).toBe(1);
    expect(clampDetourFactor(1.35)).toBe(1.35);
  });

  it("throws on a tolerance of zero, a negative one, and one that is not a number", () => {
    // A denominator cannot be dropped the way a correction can — with a
    // broken tolerance there is no answer, so the run fails instead.
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => assertToleranceKm(bad)).toThrow(BurdenError);
      expect(() => burdenValue(8, 1, bad)).toThrow(/cannot be divided by/);
    }
  });

  it("names the person whose tolerance is broken, when it knows who they are", () => {
    // The message goes to a group of friends, so it has to name someone
    // rather than print a row id.
    try {
      assertToleranceKm(0, { id: "u-dana", name: "Dana" });
      expect.unreachable("a tolerance of zero must not be accepted");
    } catch (error) {
      expect(error).toBeInstanceOf(BurdenError);
      const burden = error as BurdenError;
      expect(burden.kind).toBe("bad_tolerance");
      expect(burden.participantId).toBe("u-dana");
      expect(burden.message).toContain("Dana");
    }
  });

  it("refuses a distance that is negative or not a number", () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => burdenValue(bad, 1, 8)).toThrow(BurdenError);
    }
  });

  it("carries no participant when the fault is not a person's", () => {
    try {
      burdenValue(-1, 1, 8);
      expect.unreachable("a negative distance must not be accepted");
    } catch (error) {
      expect((error as BurdenError).participantId).toBeNull();
    }
  });
});

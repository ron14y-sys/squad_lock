import { describe, expect, it } from "vitest";

import { roundLatLng, roundToNeighbourhood } from "./geo";

describe("roundToNeighbourhood", () => {
  it("rounds to 2 decimal places", () => {
    expect(roundToNeighbourhood({ lat: 32.0812345, lng: 34.7839999 })).toEqual({
      latKey: 32.08,
      lngKey: 34.78,
    });
  });

  it("two coordinates differing only past the 2nd decimal produce the identical key", () => {
    const a = roundToNeighbourhood({ lat: 32.0801, lng: 34.7799 });
    const b = roundToNeighbourhood({ lat: 32.0849, lng: 34.7751 });
    expect(a).toEqual(b);
  });
});

describe("roundLatLng", () => {
  it("is roundToNeighbourhood's pair, back as a LatLng", () => {
    expect(roundLatLng({ lat: 32.0812345, lng: 34.7839999 })).toEqual({
      lat: 32.08,
      lng: 34.78,
    });
  });

  it("agrees with roundToNeighbourhood on the same input — one rounding rule, not two", () => {
    const center = { lat: 32.055, lng: 34.771 };
    const { latKey, lngKey } = roundToNeighbourhood(center);
    expect(roundLatLng(center)).toEqual({ lat: latKey, lng: lngKey });
  });
});

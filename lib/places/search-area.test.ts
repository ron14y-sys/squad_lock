import { describe, expect, it } from "vitest";

import type { LatLng } from "@/lib/types";
import { deriveSearchCentres } from "./search-area";

const DANA: LatLng = { lat: 32.0809, lng: 34.7806 }; // Florentin
const YOAV: LatLng = { lat: 32.0668, lng: 34.7647 }; // Neve Tzedek
const SAME_NEIGHBOURHOOD_AS_DANA: LatLng = { lat: 32.0801, lng: 34.7799 };

describe("deriveSearchCentres", () => {
  it("is one centre per distinct participant origin", () => {
    const centres = deriveSearchCentres([DANA, YOAV]);
    expect(centres).toHaveLength(2);
  });

  it("dedupes two origins that round to the same neighbourhood", () => {
    const centres = deriveSearchCentres([DANA, SAME_NEIGHBOURHOOD_AS_DANA]);
    expect(centres).toHaveLength(1);
  });

  it("is empty for no origins and no extra regions", () => {
    expect(deriveSearchCentres([])).toEqual([]);
  });

  it("is exactly extraRegions, deduplicated, when there are no origins", () => {
    const centres = deriveSearchCentres([], [DANA, DANA]);
    expect(centres).toEqual([{ lat: 32.08, lng: 34.78 }]);
  });

  it("adds an extra region as a new centre when it doesn't overlap an origin", () => {
    const farAway: LatLng = { lat: 31.5, lng: 34.5 }; // Ashdod-ish, nowhere near Dana or Yoav
    const centres = deriveSearchCentres([DANA, YOAV], [farAway]);
    expect(centres).toHaveLength(3);
  });

  it("dedupes an extra region that coincides with an existing origin, rather than adding a duplicate centre", () => {
    const centres = deriveSearchCentres([DANA], [SAME_NEIGHBOURHOOD_AS_DANA]);
    expect(centres).toHaveLength(1);
  });

  // The widening-only invariant (spec §4.1g): whatever extraRegions contains
  // — including nothing at all, including something that overlaps a baseline
  // centre — every baseline centre is still present in the result. Nothing
  // extraRegions can contain removes a baseline centre.
  it("widening-only: the baseline is always a subset of the result, for any extraRegions", () => {
    const origins = [DANA, YOAV];
    const baseline = deriveSearchCentres(origins);

    for (const extraRegions of [
      [],
      [{ lat: 0, lng: 0 }],
      [DANA],
      [DANA, YOAV, { lat: -10, lng: 170 }],
    ]) {
      const widened = deriveSearchCentres(origins, extraRegions);
      for (const centre of baseline) {
        expect(widened).toContainEqual(centre);
      }
    }
  });

  it("rounds each centre to neighbourhood granularity", () => {
    const [centre] = deriveSearchCentres([{ lat: 32.081234, lng: 34.780987 }]);
    expect(centre).toEqual({ lat: 32.08, lng: 34.78 });
  });
});

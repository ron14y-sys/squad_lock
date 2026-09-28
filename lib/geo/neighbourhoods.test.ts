import { describe, expect, it } from "vitest";

import {
  NEIGHBOURHOODS,
  findNeighbourhoodById,
  findNeighbourhoodByLabel,
} from "./neighbourhoods";

describe("NEIGHBOURHOODS", () => {
  it("has unique ids and unique labels — the label is what gets stored and looked up", () => {
    const ids = NEIGHBOURHOODS.map((n) => n.id);
    const labels = NEIGHBOURHOODS.map((n) => n.label);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("keeps every centre inside Israel's rough bounding box, so a swapped lat/lng or a typo cannot ship", () => {
    for (const n of NEIGHBOURHOODS) {
      expect(n.centre.lat, n.label).toBeGreaterThan(29.4);
      expect(n.centre.lat, n.label).toBeLessThan(33.4);
      expect(n.centre.lng, n.label).toBeGreaterThan(34.2);
      expect(n.centre.lng, n.label).toBeLessThan(35.9);
    }
  });

  it("includes the cities the team lives in", () => {
    for (const label of ["חולון", "רמת גן", "אשדוד"]) {
      expect(findNeighbourhoodByLabel(label), label).toBeDefined();
    }
  });

  it("looks an entry up by id and by stored label, and returns nothing for free text", () => {
    expect(findNeighbourhoodById("holon")?.label).toBe("חולון");
    expect(findNeighbourhoodByLabel(" חולון ")?.id).toBe("holon");
    expect(findNeighbourhoodByLabel("ליד הים")).toBeUndefined();
    expect(findNeighbourhoodByLabel(null)).toBeUndefined();
  });
});

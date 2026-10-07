import { describe, expect, it } from "vitest";

import {
  CUISINES,
  CUISINE_GOOGLE_TYPES,
  cuisinesOfTypes,
  softPreferencesFromJson,
  venueKindsOfTypes,
} from "./vocabulary";

describe("softPreferencesFromJson", () => {
  it("is empty for anything that is not an object", () => {
    expect(softPreferencesFromJson(null)).toEqual({});
    expect(softPreferencesFromJson("bar")).toEqual({});
  });

  it("keeps known values, drops unknown ones and repeats, and leaves out a list left empty", () => {
    expect(
      softPreferencesFromJson({
        budget: "cheap",
        venueKinds: ["bar", "bar", "club"],
        cuisines: ["french"],
      })
    ).toEqual({ venueKinds: ["bar"] });
  });
});

describe("venueKindsOfTypes", () => {
  it("makes a bar that serves food both a bar and a restaurant", () => {
    expect(venueKindsOfTypes(["bar", "restaurant", "food"])).toEqual([
      "bar",
      "restaurant",
    ]);
  });

  it("counts a pub, a wine bar and a coffee shop as their kinds", () => {
    expect(venueKindsOfTypes(["pub"])).toEqual(["bar"]);
    expect(venueKindsOfTypes(["wine_bar"])).toEqual(["bar"]);
    expect(venueKindsOfTypes(["coffee_shop"])).toEqual(["cafe"]);
  });

  it("is empty for a place that is none of them", () => {
    expect(venueKindsOfTypes(["night_club", "point_of_interest"])).toEqual([]);
  });
});

describe("cuisinesOfTypes", () => {
  it("reads the cuisine from Google's restaurant type", () => {
    expect(cuisinesOfTypes(["restaurant", "japanese_restaurant"])).toEqual([
      "sushi",
    ]);
    expect(cuisinesOfTypes(["steak_house"])).toEqual(["meat"]);
  });

  it("is empty for a plain restaurant", () => {
    expect(cuisinesOfTypes(["restaurant", "food"])).toEqual([]);
  });

  it("maps every approved cuisine to at least one Google type", () => {
    for (const cuisine of CUISINES) {
      expect(CUISINE_GOOGLE_TYPES[cuisine].length).toBeGreaterThan(0);
    }
  });
});

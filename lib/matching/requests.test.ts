import { describe, expect, it } from "vitest";

import {
  answersRequest,
  googleTypesFor,
  isRequest,
  matchesAnyPreference,
} from "./requests";

// Places `types` as Google returns them for each kind of venue.
const BAR = ["bar", "point_of_interest", "establishment"];
const BAR_WITH_FOOD = ["bar", "restaurant", "food", "establishment"];
const RESTAURANT = ["restaurant", "food", "establishment"];
const ITALIAN = ["italian_restaurant", "restaurant", "food"];
const ITALIAN_BAR = ["wine_bar", "italian_restaurant", "bar", "restaurant"];

describe("answersRequest", () => {
  it("keeps a venue of the kind asked for, and drops one that is not", () => {
    expect(answersRequest(BAR, { venueKinds: ["bar"] })).toBe(true);
    expect(answersRequest(RESTAURANT, { venueKinds: ["bar"] })).toBe(false);
  });

  it("needs both the kind and the cuisine when both were asked for", () => {
    const request = {
      venueKinds: ["bar" as const],
      cuisines: ["italian" as const],
    };
    expect(answersRequest(ITALIAN_BAR, request)).toBe(true);
    expect(answersRequest(BAR, request)).toBe(false);
    expect(answersRequest(ITALIAN, request)).toBe(false);
  });

  it("drops an avoided kind", () => {
    expect(
      answersRequest(RESTAURANT, { avoidVenueKinds: ["restaurant"] })
    ).toBe(false);
    expect(answersRequest(BAR, { avoidVenueKinds: ["restaurant"] })).toBe(true);
  });

  // The rule from #220's eval sweep: "a bar, not a restaurant".
  it("keeps a venue that is avoided but also answers what the same person asked for", () => {
    const request = {
      venueKinds: ["bar" as const],
      avoidVenueKinds: ["restaurant" as const],
    };
    expect(answersRequest(BAR_WITH_FOOD, request)).toBe(true);
    expect(answersRequest(RESTAURANT, request)).toBe(false);
  });

  it("drops an avoided cuisine", () => {
    expect(answersRequest(ITALIAN, { avoidCuisines: ["italian"] })).toBe(false);
  });
});

describe("isRequest", () => {
  it("is a kind, a cuisine or an avoidance — not a budget alone", () => {
    expect(isRequest({ venueKinds: ["bar"] })).toBe(true);
    expect(isRequest({ avoidCuisines: ["sushi"] })).toBe(true);
    expect(isRequest({ budget: "modest" })).toBe(false);
    expect(isRequest(null)).toBe(false);
  });
});

describe("googleTypesFor", () => {
  it("asks Google for every type of every kind and cuisine, once", () => {
    expect(
      googleTypesFor([
        { venueKinds: ["bar"] },
        { venueKinds: ["bar"], cuisines: ["pizza"] },
      ])
    ).toEqual(["bar", "pub", "wine_bar", "bar_and_grill", "pizza_restaurant"]);
  });

  it("asks for nothing when nobody wants anything", () => {
    expect(googleTypesFor([{}, { budget: "modest" }])).toEqual([]);
  });
});

describe("matchesAnyPreference", () => {
  it("matches a venue anyone in the group listed", () => {
    expect(
      matchesAnyPreference(BAR, [
        { cuisines: ["sushi"] },
        { venueKinds: ["bar"] },
      ])
    ).toBe(true);
    expect(matchesAnyPreference(RESTAURANT, [{ venueKinds: ["bar"] }])).toBe(
      false
    );
  });
});

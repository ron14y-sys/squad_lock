import { describe, expect, it } from "vitest";

import { parseVenuePrice, venuePriceFromGoogle } from "./price";

const ils = (units: string, nanos?: number) => ({
  currencyCode: "ILS",
  units,
  ...(nanos !== undefined ? { nanos } : {}),
});

describe("venuePriceFromGoogle (#249)", () => {
  it("reads a full range, with the level beside it", () => {
    expect(
      venuePriceFromGoogle({
        priceLevel: "PRICE_LEVEL_MODERATE",
        priceRange: { startPrice: ils("60"), endPrice: ils("90") },
      })
    ).toEqual({ level: "moderate", min: 60, max: 90, currency: "ILS" });
  });

  it("keeps an open-ended range as it is: only a start, or only an end", () => {
    expect(
      venuePriceFromGoogle({ priceRange: { startPrice: ils("100") } })
    ).toEqual({ min: 100, currency: "ILS" });
    expect(
      venuePriceFromGoogle({ priceRange: { endPrice: ils("50") } })
    ).toEqual({ max: 50, currency: "ILS" });
  });

  it("rounds to a whole amount and adds nanos to units", () => {
    expect(
      venuePriceFromGoogle({
        priceRange: { startPrice: ils("59", 600_000_000), endPrice: ils("90") },
      })
    ).toEqual({ min: 60, max: 90, currency: "ILS" });
  });

  it("treats a missing `units` as 0 and drops a lower end of 0", () => {
    expect(
      venuePriceFromGoogle({
        priceRange: {
          startPrice: { currencyCode: "ILS" },
          endPrice: ils("50"),
        },
      })
    ).toEqual({ max: 50, currency: "ILS" });
  });

  it("falls back to the level alone when there is no range", () => {
    expect(
      venuePriceFromGoogle({ priceLevel: "PRICE_LEVEL_EXPENSIVE" })
    ).toEqual({ level: "expensive" });
    expect(venuePriceFromGoogle({ priceLevel: "PRICE_LEVEL_FREE" })).toEqual({
      level: "free",
    });
  });

  it("is undefined when Google gave nothing usable", () => {
    expect(venuePriceFromGoogle({})).toBeUndefined();
    expect(
      venuePriceFromGoogle({ priceLevel: "PRICE_LEVEL_UNSPECIFIED" })
    ).toBeUndefined();
    expect(
      venuePriceFromGoogle({ priceLevel: "SOMETHING_NEW" })
    ).toBeUndefined();
    expect(venuePriceFromGoogle({ priceRange: {} })).toBeUndefined();
  });

  it("drops a range whose two ends disagree on currency, keeping the level", () => {
    expect(
      venuePriceFromGoogle({
        priceLevel: "PRICE_LEVEL_INEXPENSIVE",
        priceRange: {
          startPrice: ils("60"),
          endPrice: { currencyCode: "USD", units: "25" },
        },
      })
    ).toEqual({ level: "inexpensive" });
  });

  it("drops a range with an amount but no currency", () => {
    expect(
      venuePriceFromGoogle({ priceRange: { startPrice: { units: "60" } } })
    ).toBeUndefined();
  });

  it("ignores a negative or non-numeric amount", () => {
    expect(
      venuePriceFromGoogle({
        priceRange: { startPrice: ils("-5"), endPrice: ils("abc") },
      })
    ).toBeUndefined();
  });
});

describe("parseVenuePrice (#249)", () => {
  it("round-trips what venuePriceFromGoogle produces", () => {
    const price = { level: "moderate", min: 60, max: 90, currency: "ILS" };
    expect(parseVenuePrice(price)).toEqual(price);
    expect(parseVenuePrice({ level: "expensive" })).toEqual({
      level: "expensive",
    });
  });

  it("is undefined for null, a non-object, an array or an empty object", () => {
    expect(parseVenuePrice(null)).toBeUndefined();
    expect(parseVenuePrice(undefined)).toBeUndefined();
    expect(parseVenuePrice("cheap")).toBeUndefined();
    expect(parseVenuePrice([60, 90])).toBeUndefined();
    expect(parseVenuePrice({})).toBeUndefined();
  });

  it("drops each field that is not valid, and keeps the rest", () => {
    expect(
      parseVenuePrice({ level: "luxury", min: -1, max: 90, currency: "ILS" })
    ).toEqual({ max: 90, currency: "ILS" });
    expect(parseVenuePrice({ level: "free", min: "60" })).toEqual({
      level: "free",
    });
  });

  it("drops amounts that come without a currency", () => {
    expect(parseVenuePrice({ min: 60, max: 90 })).toBeUndefined();
  });
});

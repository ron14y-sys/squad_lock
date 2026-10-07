import { describe, expect, it } from "vitest";

import {
  alsoConsideredOf,
  describeContext,
  minutesUntil,
  uncheckedCalendarsOf,
  withoutOrigin,
} from "./meeting-detail";

const people = [
  { userId: "u1", name: "רון" },
  { userId: "u2", name: "דני" },
  { userId: "u3", name: "אלדד" },
];

describe("withoutOrigin", () => {
  it("names the people with no home point, and only them", () => {
    const result = withoutOrigin(
      people,
      [
        { userId: "u1", homeLat: 32.07, homeLng: 34.82 },
        { userId: "u2", homeLat: null, homeLng: null },
        { userId: "u3", homeLat: 32.01, homeLng: 34.78 },
      ],
      []
    );

    expect(result).toEqual([{ userId: "u2", name: "דני" }]);
  });

  it("counts someone with no profile row at all as missing", () => {
    const result = withoutOrigin(
      people,
      [
        { userId: "u1", homeLat: 32.07, homeLng: 34.82 },
        { userId: "u3", homeLat: 32.01, homeLng: 34.78 },
      ],
      []
    );

    expect(result).toEqual([{ userId: "u2", name: "דני" }]);
  });

  it("does not flag someone who gave an origin for this meeting — tonight's amendment wins over home", () => {
    const result = withoutOrigin(
      people,
      [
        { userId: "u1", homeLat: 32.07, homeLng: 34.82 },
        { userId: "u2", homeLat: null, homeLng: null },
        { userId: "u3", homeLat: 32.01, homeLng: 34.78 },
      ],
      [{ userId: "u2" }]
    );

    expect(result).toEqual([]);
  });

  it("treats half a point as no point", () => {
    const result = withoutOrigin(
      [people[0]],
      [{ userId: "u1", homeLat: 32.07, homeLng: null }],
      []
    );

    expect(result).toEqual([people[0]]);
  });
});

describe("describeContext", () => {
  it("names each mobility mode in Hebrew, never the stored enum (#175)", () => {
    expect(
      describeContext({
        note: null,
        originLabel: null,
        mobilityWindows: [{ mode: "car", available: false }],
      })
    ).toBe("אין רכב הערב");

    expect(
      describeContext({
        note: null,
        originLabel: null,
        mobilityWindows: [{ mode: "transit", available: false }],
      })
    ).toBe("אין תחבורה ציבורית הערב");

    expect(
      describeContext({
        note: null,
        originLabel: null,
        mobilityWindows: [{ mode: "walk", available: false }],
      })
    ).toBe("אין הליכה הערב");
  });

  it("prefers the free-text note over everything else", () => {
    expect(
      describeContext({
        note: "יוצא מוקדם הערב",
        originLabel: "תל אביב",
        mobilityWindows: [{ mode: "car", available: false }],
      })
    ).toBe("יוצא מוקדם הערב");
  });

  it("falls back to the origin label when there is no note", () => {
    expect(
      describeContext({
        note: null,
        originLabel: "תל אביב",
        mobilityWindows: [],
      })
    ).toBe("מגיע/ה מתל אביב");
  });
});

describe("minutesUntil (B9 part five)", () => {
  const now = new Date("2026-10-06T12:00:00.000Z");
  const at = (ms: number) => new Date(now.getTime() + ms);

  it("is null when there is no wait scheduled", () => {
    expect(minutesUntil(null, now)).toBeNull();
  });

  it("is null once the moment has passed, or is exactly now", () => {
    expect(minutesUntil(at(-1), now)).toBeNull();
    expect(minutesUntil(at(0), now)).toBeNull();
  });

  it("rounds a partial minute up, never down to zero", () => {
    expect(minutesUntil(at(1), now)).toBe(1);
    expect(minutesUntil(at(61_000), now)).toBe(2);
  });

  it("is exact on a whole number of minutes", () => {
    expect(minutesUntil(at(10 * 60_000), now)).toBe(10);
  });
});

describe("uncheckedCalendarsOf", () => {
  it("names the people a proposal's calendar facts point at, and only them", () => {
    expect(
      uncheckedCalendarsOf(
        [
          { kind: "opening_hours" },
          { kind: "calendar", userId: "u3" },
          { kind: "dietary", tag: "vegan" },
          { kind: "calendar", userId: "u1" },
        ],
        people
      )
    ).toEqual([
      { userId: "u3", name: "אלדד" },
      { userId: "u1", name: "רון" },
    ]);
  });

  it("is empty for a proposal with no calendar facts", () => {
    expect(uncheckedCalendarsOf([{ kind: "opening_hours" }], people)).toEqual(
      []
    );
  });

  it("leaves out someone who is no longer in the meeting", () => {
    expect(
      uncheckedCalendarsOf([{ kind: "calendar", userId: "gone" }], people)
    ).toEqual([]);
  });
});

describe("alsoConsideredOf", () => {
  const option = (
    rank: number,
    venueName: string,
    venuePlaceId: string | null
  ) => ({
    rank,
    venueName,
    venuePlaceId,
  });

  it("lists nothing when ranks 2 and 3 are the proposed venue at other hours", () => {
    // What was seen: "גם שקלנו: קפה גן סיפור חולון, קפה גן סיפור חולון".
    expect(
      alsoConsideredOf([
        option(1, "קפה גן סיפור חולון", "p1"),
        option(2, "קפה גן סיפור חולון", "p1"),
        option(3, "קפה גן סיפור חולון", "p1"),
      ])
    ).toEqual([]);
  });

  it("lists each other venue once, in rank order", () => {
    expect(
      alsoConsideredOf([
        option(3, "בית קפה ב", "p3"),
        option(1, "קפה גן סיפור חולון", "p1"),
        option(2, "בית קפה ב", "p3"),
      ])
    ).toEqual(["בית קפה ב"]);
    expect(
      alsoConsideredOf([
        option(1, "א", "p1"),
        option(2, "ב", "p2"),
        option(3, "ג", "p3"),
      ])
    ).toEqual(["ב", "ג"]);
  });

  it("tells venues with no place id apart by name", () => {
    expect(
      alsoConsideredOf([
        option(1, "המקום שנקבע", null),
        option(2, "המקום שנקבע", null),
        option(3, "מקום אחר", null),
      ])
    ).toEqual(["מקום אחר"]);
  });
});

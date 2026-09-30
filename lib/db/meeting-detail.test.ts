import { describe, expect, it } from "vitest";

import { describeContext, withoutOrigin } from "./meeting-detail";

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

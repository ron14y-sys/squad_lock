import { describe, expect, it } from "vitest";

import {
  constraintUpdateFromLabels,
  hasLabels,
  sentenceFromLabels,
} from "./labelled-rejection";

// Local Israel time is UTC+3 on this date: 16:00Z is 19:00 there.
const REJECTED_AT_19 = new Date("2026-10-18T16:00:00.000Z");

describe("hasLabels", () => {
  it("is false for nothing, and for labels with nothing in them", () => {
    expect(hasLabels({})).toBe(false);
    expect(hasLabels({ venueKinds: [], cuisines: [], tooFar: false })).toBe(
      false
    );
  });

  it("is true for any single label", () => {
    expect(hasLabels({ venueKinds: ["bar"] })).toBe(true);
    expect(hasLabels({ cuisines: ["pizza"] })).toBe(true);
    expect(hasLabels({ tooFar: true })).toBe(true);
    expect(hasLabels({ suitableStart: "21:00" })).toBe(true);
    expect(hasLabels({ tooExpensive: true })).toBe(true);
  });
});

describe("constraintUpdateFromLabels", () => {
  it("turns a disliked style and cuisine into what to avoid tonight, under 'soft'", () => {
    const update = constraintUpdateFromLabels(
      { venueKinds: ["bar"], cuisines: ["pizza", "sushi"] },
      REJECTED_AT_19
    );
    expect(update.softPreferences).toEqual({
      avoidVenueKinds: ["bar"],
      avoidCuisines: ["pizza", "sushi"],
    });
    expect(update.objection).toBe("soft");
    expect(update.distance).toBeNull();
    expect(update.start).toBeNull();
  });

  it("does not repeat a value picked twice", () => {
    const update = constraintUpdateFromLabels(
      { cuisines: ["pizza", "pizza"] },
      REJECTED_AT_19
    );
    expect(update.softPreferences.avoidCuisines).toEqual(["pizza"]);
  });

  it("makes 'too expensive' a modest budget for tonight", () => {
    const update = constraintUpdateFromLabels(
      { tooExpensive: true },
      REJECTED_AT_19
    );
    expect(update.softPreferences).toEqual({ budget: "modest" });
    expect(update.objection).toBe("soft");
  });

  it("makes 'too far' a direction, left to toleranceFor to measure", () => {
    const update = constraintUpdateFromLabels({ tooFar: true }, REJECTED_AT_19);
    expect(update.distance).toEqual({ kind: "closer" });
    expect(update.softPreferences).toEqual({});
    expect(update.objection).toBe("distance");
  });

  it("reads a later hour than the rejected one as 'not before'", () => {
    const update = constraintUpdateFromLabels(
      { suitableStart: "21:00" },
      REJECTED_AT_19
    );
    expect(update.start).toEqual({ notBefore: "21:00" });
    expect(update.objection).toBe("time");
  });

  it("reads an earlier hour as 'not after'", () => {
    const update = constraintUpdateFromLabels(
      { suitableStart: "17:30" },
      REJECTED_AT_19
    );
    expect(update.start).toEqual({ notAfter: "17:30" });
  });

  it("sets no bound for the very hour that was rejected, or when nothing was", () => {
    expect(
      constraintUpdateFromLabels({ suitableStart: "19:00" }, REJECTED_AT_19)
        .start
    ).toBeNull();
    expect(
      constraintUpdateFromLabels({ suitableStart: "21:00" }, null).start
    ).toBeNull();
  });

  it("records the strongest thing when several are ticked: the place before the distance before the hour", () => {
    expect(
      constraintUpdateFromLabels(
        { tooFar: true, suitableStart: "21:00", cuisines: ["pizza"] },
        REJECTED_AT_19
      ).objection
    ).toBe("soft");
    expect(
      constraintUpdateFromLabels(
        { tooFar: true, suitableStart: "21:00" },
        REJECTED_AT_19
      ).objection
    ).toBe("distance");
  });

  it("says nothing was understood for an empty set, and invents nothing", () => {
    const update = constraintUpdateFromLabels({}, REJECTED_AT_19);
    expect(update.objection).toBe("none");
    expect(update.untranslated).toBeNull();
    expect(update.notThisPlace).toBe(false);
  });
});

describe("sentenceFromLabels", () => {
  it("is empty when nothing was ticked", () => {
    expect(sentenceFromLabels({})).toBe("");
  });

  it("names every label in Hebrew, in a fixed order", () => {
    expect(
      sentenceFromLabels({
        tooExpensive: true,
        suitableStart: "21:00",
        tooFar: true,
        cuisines: ["pizza"],
        venueKinds: ["bar"],
      })
    ).toBe(
      "לא מתאים לי: סגנון המקום (בר); סוג האוכל (פיצה); רחוק לי מדי; השעה לא מתאימה, מתאים לי 21:00; יקר לי מדי"
    );
  });
});

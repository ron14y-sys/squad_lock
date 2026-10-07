import { describe, expect, it } from "vitest";

import {
  meetingStatusLabel,
  membersLabel,
  uncheckedCalendarNote,
  unverifiedNote,
} from "./hebrew-labels";

describe("membersLabel", () => {
  it("uses the singular for one member, not '1 חברים'", () => {
    expect(membersLabel(1)).toBe("חבר אחד");
  });

  it("uses the plural with the number for any other count", () => {
    expect(membersLabel(2)).toBe("2 חברים");
    expect(membersLabel(0)).toBe("0 חברים");
    expect(membersLabel(12)).toBe("12 חברים");
  });
});

describe("meetingStatusLabel", () => {
  it("calls a meeting's opening search a search, not a re-weighing", () => {
    expect(meetingStatusLabel("reweighing", null, true)).toBe("מחפשים הצעה");
  });

  it("still calls a search after a proposal a re-weighing", () => {
    expect(meetingStatusLabel("reweighing", null, false)).toBe("משוקלל מחדש");
    expect(meetingStatusLabel("reweighing", null)).toBe("משוקלל מחדש");
  });
});

describe("uncheckedCalendarNote", () => {
  it("says nothing when every calendar was checked", () => {
    expect(uncheckedCalendarNote([])).toBeNull();
  });

  it("names one person, speaking of the calendar so no gender is needed", () => {
    expect(uncheckedCalendarNote(["רון"])).toBe(
      "הזמן הזה לא נבדק מול היומן של רון, כי הוא עוד לא מחובר."
    );
  });

  it("lists several in the plural", () => {
    expect(uncheckedCalendarNote(["רון", "דנה", "יואב"])).toBe(
      "הזמן הזה לא נבדק מול היומנים של רון, דנה ויואב, כי הם עוד לא מחוברים."
    );
  });
});

describe("unverifiedNote", () => {
  it("leaves a calendar out of the venue sentence", () => {
    expect(unverifiedNote([{ kind: "calendar", userId: "u1" }])).toBeNull();
    expect(
      unverifiedNote([
        { kind: "opening_hours" },
        { kind: "calendar", userId: "u1" },
      ])
    ).toBe("לא הצלחנו לאמת את שעות הפתיחה — כדאי לטלפן ולוודא לפני שיוצאים.");
  });
});

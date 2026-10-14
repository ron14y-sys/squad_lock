import { describe, expect, it } from "vitest";

import {
  meetingStatusLabel,
  membersLabel,
  notificationText,
  stuckExplanation,
  timeOfDayMovedNote,
  uncheckedCalendarNote,
  unmetPinnedVenueNote,
  unmetRequestNote,
  unverifiedNote,
  venuePriceText,
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

describe("unmetRequestNote (#221)", () => {
  it("names what was asked for and not found", () => {
    expect(
      unmetRequestNote([
        { kind: "opening_hours" },
        { kind: "unmet_request", venueKinds: ["bar"], cuisines: ["italian"] },
      ])
    ).toBe(
      "לא מצאנו מקום שמתאים לכולם מהסוג שביקשתם (בר, איטלקי), אז הצענו משהו אחר."
    );
  });

  it("says it plainly when only an avoidance went unmet", () => {
    expect(
      unmetRequestNote([
        { kind: "unmet_request", venueKinds: [], cuisines: [] },
      ])
    ).toBe(
      "לא מצאנו מקום שמתאים לכולם ועונה על מה שביקשתם הערב, אז הצענו משהו אחר."
    );
  });

  it("is nothing when every request was answered", () => {
    expect(unmetRequestNote([{ kind: "opening_hours" }])).toBeNull();
  });

  it("is not read as something about the venue", () => {
    expect(
      unverifiedNote([
        { kind: "unmet_request", venueKinds: ["bar"], cuisines: [] },
      ])
    ).toBeNull();
  });
});

describe("unmetPinnedVenueNote (#212)", () => {
  it("says the named place is not a restaurant, bar or café (#240)", () => {
    expect(
      unmetPinnedVenueNote([
        {
          kind: "unmet_pinned_venue",
          venue: "סטודיו יוגה",
          reason: "not_a_venue",
        },
      ])
    ).toBe("״סטודיו יוגה״ הוא לא מסעדה, בר או בית קפה, אז הצענו משהו אחר.");
  });

  it("says no place of that name was found", () => {
    expect(
      unmetPinnedVenueNote([
        { kind: "unmet_pinned_venue", venue: "בר הים", reason: "not_found" },
      ])
    ).toBe("לא מצאנו מקום בשם ״בר הים״, אז הצענו משהו אחר.");
  });

  it("says it is too far for some of the group, naming no one", () => {
    expect(
      unmetPinnedVenueNote([
        { kind: "unmet_pinned_venue", venue: "בר הים", reason: "too_far" },
      ])
    ).toBe(
      "המקום שביקשתם (בר הים) רחוק מדי עבור חלק מהחברים, אז הצענו משהו אחר."
    );
  });

  it("says no shared time fits it when it fails anything else", () => {
    expect(
      unmetPinnedVenueNote([
        { kind: "unmet_pinned_venue", venue: "בר הים", reason: "unavailable" },
      ])
    ).toBe(
      "לא מצאנו זמן שמתאים לכולם והמקום שביקשתם פתוח בו (בר הים), אז הצענו משהו אחר."
    );
  });

  it("is nothing when the venue was offered", () => {
    expect(unmetPinnedVenueNote([{ kind: "opening_hours" }])).toBeNull();
  });

  it("is not read as something about the venue's hours or diet", () => {
    expect(
      unverifiedNote([
        { kind: "unmet_pinned_venue", venue: "בר הים", reason: "too_far" },
      ])
    ).toBeNull();
  });
});

describe("notificationText (#250)", () => {
  const group = (meetingsCancelled: number | null) => ({
    name: "השישיה",
    actorName: "דנה",
    meetingsCancelled,
  });

  it("keeps the one-line label for a meeting notification", () => {
    expect(notificationText({ kind: "stuck" })).toBe(
      "לא מצאנו הצעה לפגישה — צריך להחליט ידנית"
    );
  });

  it("says who left and from which group", () => {
    expect(notificationText({ kind: "member_left", group: group(null) })).toBe(
      'דנה עזב/ה את הקבוצה "השישיה".'
    );
  });

  it("says how many open meetings were cancelled, with the singular for one", () => {
    expect(
      notificationText({ kind: "group_inactive", group: group(2) })
    ).toContain("2 פגישות פתוחות בוטלו.");
    expect(
      notificationText({ kind: "group_inactive", group: group(1) })
    ).toContain("פגישה פתוחה אחת בוטלה.");
    expect(
      notificationText({ kind: "group_inactive", group: group(0) })
    ).not.toContain("בוטלו");
    expect(
      notificationText({ kind: "group_inactive", group: group(0) })
    ).toContain("הזמינו עוד חברים כדי להמשיך.");
  });

  it("says the admin deleted the group and how many meetings went with it", () => {
    expect(notificationText({ kind: "group_deleted", group: group(3) })).toBe(
      'המנהל/ת מחק/ה את הקבוצה "השישיה". 3 פגישות נמחקו איתה.'
    );
  });

  it("#256: says who was removed, and tells the one removed", () => {
    expect(
      notificationText({ kind: "member_removed", group: group(null) })
    ).toBe('דנה הוסר/ה מהקבוצה "השישיה".');
    expect(
      notificationText({ kind: "removed_from_group", group: group(null) })
    ).toBe('המנהל/ת הסיר/ה אותך מהקבוצה "השישיה".');
  });

  it("#256: an inactive group says the person went out, left or removed", () => {
    expect(
      notificationText({ kind: "group_inactive", group: group(0) })
    ).toContain('דנה יצא/ה מהקבוצה "השישיה"');
  });

  it("tells a new admin which group", () => {
    expect(
      notificationText({ kind: "became_admin", group: group(null) })
    ).toContain('הפכת למנהל/ת של הקבוצה "השישיה"');
  });

  it("falls back to the label when the notice has no group name", () => {
    expect(
      notificationText({
        kind: "group_deleted",
        group: { name: null, actorName: null, meetingsCancelled: null },
      })
    ).toBe("הקבוצה נמחקה");
  });
});

describe("venuePriceText (#249)", () => {
  it("words a range in shekels as expected, per diner", () => {
    expect(
      venuePriceText({ min: 60, max: 90, currency: "ILS", level: "moderate" })
    ).toBe("מחיר צפוי: כ-60–90 ₪ לסועד");
  });

  it("words one amount, and an open-ended range", () => {
    expect(venuePriceText({ min: 80, max: 80, currency: "ILS" })).toBe(
      "מחיר צפוי: כ-80 ₪ לסועד"
    );
    expect(venuePriceText({ min: 100, currency: "ILS" })).toBe(
      "מחיר צפוי: מ-100 ₪ לסועד"
    );
    expect(venuePriceText({ max: 50, currency: "ILS" })).toBe(
      "מחיר צפוי: עד 50 ₪ לסועד"
    );
  });

  it("reads Google's lowest bracket (from 1) as 'up to', not 'from 1'", () => {
    expect(venuePriceText({ min: 1, max: 50, currency: "ILS" })).toBe(
      "מחיר צפוי: עד 50 ₪ לסועד"
    );
    // A lone 1 says nothing: the level, if any, speaks instead.
    expect(venuePriceText({ min: 1, currency: "ILS" })).toBeNull();
    expect(
      venuePriceText({ min: 1, currency: "ILS", level: "inexpensive" })
    ).toBe("מחיר צפוי: זול");
  });

  it("falls back to the coarse level when there is no range", () => {
    expect(venuePriceText({ level: "inexpensive" })).toBe("מחיר צפוי: זול");
    expect(venuePriceText({ level: "very_expensive" })).toBe(
      "מחיר צפוי: יקר מאוד"
    );
  });

  it("never shows another currency's number as shekels, only the level", () => {
    expect(
      venuePriceText({ min: 25, max: 40, currency: "USD", level: "expensive" })
    ).toBe("מחיר צפוי: יקר");
    expect(venuePriceText({ min: 25, max: 40, currency: "USD" })).toBeNull();
  });

  it("is null when there is nothing to say", () => {
    expect(venuePriceText(null)).toBeNull();
    expect(venuePriceText(undefined)).toBeNull();
    expect(venuePriceText({})).toBeNull();
  });
});

describe("timeOfDayMovedNote (#247)", () => {
  it("says which part of day the proposal moved out of, and why", () => {
    expect(
      timeOfDayMovedNote([
        { kind: "time_of_day_moved", part: "midday", start: "17:00" },
      ])
    ).toBe("ההצעה הוזזה מהצהריים, כי ביקשו להתחיל מ-17:00.");
  });

  it("says nothing when the proposal stayed in its part of day", () => {
    expect(timeOfDayMovedNote([])).toBeNull();
  });
});

describe("stuckExplanation (#246, #247)", () => {
  const none = { partOfDay: null, askedStart: null } as const;

  it("only claims three tries when the cap is what stopped it", () => {
    expect(stuckExplanation({ reason: "cycle_cap", ...none })).toMatch(
      /ניסינו שלוש פעמים/
    );
    expect(stuckExplanation({ reason: "no_time", ...none })).not.toMatch(
      /שלוש פעמים/
    );
    expect(stuckExplanation({ reason: "no_venue", ...none })).not.toMatch(
      /שלוש פעמים/
    );
  });

  it("names the part of day and hour that were asked for when no time was found", () => {
    expect(
      stuckExplanation({
        reason: "no_time",
        partOfDay: "midday",
        askedStart: "17:00",
      })
    ).toMatch(/\(בצהריים, מ-17:00\)/);
  });

  it("names only what is known", () => {
    expect(
      stuckExplanation({
        reason: "no_time",
        partOfDay: "evening",
        askedStart: null,
      })
    ).toMatch(/\(בערב\)/);
    expect(stuckExplanation({ reason: "no_time", ...none })).not.toMatch(/\(/);
  });

  it("claims nothing about why when no reason was recorded", () => {
    expect(stuckExplanation({ reason: null, ...none })).toMatch(
      /^לא מצאנו הצעה שמתאימה לכולם/
    );
  });
});

import { describe, expect, it } from "vitest";

import type { Participant, PreferenceProfile, TimeSlot } from "@/lib/types";
import { commonFreeWindows, slotTolerance } from "./availability";

const slot = (startIso: string, endIso: string): TimeSlot => ({
  start: new Date(startIso),
  end: new Date(endIso),
});

/** A profile with nothing objectionable in it. Override the one field under test. */
function profile(
  overrides: Partial<PreferenceProfile> = {}
): PreferenceProfile {
  return {
    id: "p1",
    userId: "u1",
    hardConstraints: { dietary: [], allergies: [], unavailable: [] },
    softPreferences: {},
    home: { lat: 32.08, lng: 34.78 },
    homeNeighbourhood: "Florentin",
    toleranceKm: 8,
    recurringMobilityRules: [],
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

/** A participant free all week, able to travel, with no busy blocks. */
function participant(
  userId: string,
  name: string,
  overrides: Partial<Participant> = {}
): Participant {
  return {
    userId,
    name,
    profile: profile({ id: `profile-${userId}`, userId }),
    context: null,
    origin: { lat: 32.08, lng: 34.78 },
    busy: [],
    ...overrides,
  };
}

describe("commonFreeWindows", () => {
  const DAY = slot("2026-09-07T06:00:00.000Z", "2026-09-07T18:00:00.000Z");

  it("rejects a search window that does not end after it starts", () => {
    expect(() =>
      commonFreeWindows(
        [],
        slot("2026-09-07T10:00:00.000Z", "2026-09-07T09:00:00.000Z")
      )
    ).toThrow(/must end after it starts/);
  });

  it("is the whole window when nobody has a busy block", () => {
    const dana = participant("u1", "Dana");
    const yoav = participant("u2", "Yoav");

    expect(commonFreeWindows([dana, yoav], DAY)).toEqual([DAY]);
  });

  it("is empty when one participant is busy the entire window", () => {
    const dana = participant("u1", "Dana", { busy: [DAY] });

    expect(commonFreeWindows([dana], DAY)).toEqual([]);
  });

  it("ignores a busy block outside the search window", () => {
    const dana = participant("u1", "Dana", {
      busy: [slot("2026-09-06T06:00:00.000Z", "2026-09-06T18:00:00.000Z")],
    });

    expect(commonFreeWindows([dana], DAY)).toEqual([DAY]);
  });

  it("splits the window around a single busy block in the middle", () => {
    const dana = participant("u1", "Dana", {
      busy: [slot("2026-09-07T10:00:00.000Z", "2026-09-07T12:00:00.000Z")],
    });

    expect(commonFreeWindows([dana], DAY)).toEqual([
      slot("2026-09-07T06:00:00.000Z", "2026-09-07T10:00:00.000Z"),
      slot("2026-09-07T12:00:00.000Z", "2026-09-07T18:00:00.000Z"),
    ]);
  });

  it("is the union of busy blocks across different participants, not just one person's", () => {
    // Dana is busy 08:00-10:00, Yoav is busy 14:00-16:00 — two separate gaps,
    // neither participant's alone, only visible once both are considered.
    const dana = participant("u1", "Dana", {
      busy: [slot("2026-09-07T08:00:00.000Z", "2026-09-07T10:00:00.000Z")],
    });
    const yoav = participant("u2", "Yoav", {
      busy: [slot("2026-09-07T14:00:00.000Z", "2026-09-07T16:00:00.000Z")],
    });

    expect(commonFreeWindows([dana, yoav], DAY)).toEqual([
      slot("2026-09-07T06:00:00.000Z", "2026-09-07T08:00:00.000Z"),
      slot("2026-09-07T10:00:00.000Z", "2026-09-07T14:00:00.000Z"),
      slot("2026-09-07T16:00:00.000Z", "2026-09-07T18:00:00.000Z"),
    ]);
  });

  it("merges overlapping busy blocks from different participants into one gap", () => {
    // Dana 09:00-12:00, Yoav 11:00-13:00 — overlapping, so the merged busy
    // block is 09:00-13:00, not two separate ones with a gap between them.
    const dana = participant("u1", "Dana", {
      busy: [slot("2026-09-07T09:00:00.000Z", "2026-09-07T12:00:00.000Z")],
    });
    const yoav = participant("u2", "Yoav", {
      busy: [slot("2026-09-07T11:00:00.000Z", "2026-09-07T13:00:00.000Z")],
    });

    expect(commonFreeWindows([dana, yoav], DAY)).toEqual([
      slot("2026-09-07T06:00:00.000Z", "2026-09-07T09:00:00.000Z"),
      slot("2026-09-07T13:00:00.000Z", "2026-09-07T18:00:00.000Z"),
    ]);
  });

  it("clips a busy block that only partly overlaps the search window", () => {
    const dana = participant("u1", "Dana", {
      // Starts two hours before the window, ends two hours inside it.
      busy: [slot("2026-09-07T04:00:00.000Z", "2026-09-07T08:00:00.000Z")],
    });

    expect(commonFreeWindows([dana], DAY)).toEqual([
      slot("2026-09-07T08:00:00.000Z", "2026-09-07T18:00:00.000Z"),
    ]);
  });
});

describe("slotTolerance", () => {
  /** Monday 7 Sep 2026, 19:00-21:00 local (Asia/Jerusalem is UTC+3 in September). */
  const MON_EVENING = slot(
    "2026-09-07T16:00:00.000Z",
    "2026-09-07T18:00:00.000Z"
  );

  it("is the profile's baseline when nothing caps this person at this hour", () => {
    const dana = participant("u1", "Dana", {
      profile: profile({ userId: "u1", toleranceKm: 8 }),
    });

    expect(slotTolerance(dana, MON_EVENING)).toEqual({
      participantId: "u1",
      slot: MON_EVENING,
      toleranceKm: 8,
    });
  });

  it("narrows to the mode cap when only walking is available", () => {
    const dana = participant("u1", "Dana", {
      profile: profile({
        userId: "u1",
        toleranceKm: 8,
        recurringMobilityRules: [
          { kind: "mode_unavailable", weekdays: ["monday"], mode: "car" },
          { kind: "mode_unavailable", weekdays: ["monday"], mode: "transit" },
        ],
      }),
    });

    // Walking's reach cap (1km, constraints.ts's REACH_BY_MODE) is below the
    // 8km baseline, so it wins.
    expect(slotTolerance(dana, MON_EVENING).toleranceKm).toBe(1);
  });

  it("never widens past the profile's own tolerance, even with an uncapped mode", () => {
    const dana = participant("u1", "Dana", {
      profile: profile({
        userId: "u1",
        toleranceKm: 2,
        recurringMobilityRules: [
          { kind: "mode_unavailable", weekdays: ["monday"], mode: "car" },
          { kind: "mode_unavailable", weekdays: ["monday"], mode: "walk" },
        ],
      }),
    });

    // Only transit is left, and transit is uncapped — the 2km baseline stands.
    expect(slotTolerance(dana, MON_EVENING).toleranceKm).toBe(2);
  });
});

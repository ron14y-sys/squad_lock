import { describe, expect, it } from "vitest";

import { canonicalMeetingPair, meetingsConflict } from "./conflict-dismissal";

/**
 * All times below are chosen in November, well clear of Israel's DST
 * transition, so the offset (UTC+2) is unambiguous and the point of each
 * test is legible without also having to reason about daylight saving.
 */

describe("meetingsConflict", () => {
  it("flags two meetings on the same local day, a couple of hours apart", () => {
    // 2026-11-10 19:00 and 21:00 Asia/Jerusalem (UTC+2) — 17:00Z and 19:00Z.
    const a = new Date("2026-11-10T17:00:00.000Z");
    const b = new Date("2026-11-10T19:00:00.000Z");

    expect(meetingsConflict(a, b)).toBe(true);
  });

  it("does not flag a same-day pair 6 hours apart", () => {
    // The Verify scenario itself. 15:00 and 21:00 local — 13:00Z and 19:00Z.
    const a = new Date("2026-11-10T13:00:00.000Z");
    const b = new Date("2026-11-10T19:00:00.000Z");

    expect(meetingsConflict(a, b)).toBe(false);
  });

  it("does not flag a pair exactly 4 hours apart — the rule is strictly less than", () => {
    // 17:00 and 21:00 local — 15:00Z and 19:00Z.
    const a = new Date("2026-11-10T15:00:00.000Z");
    const b = new Date("2026-11-10T19:00:00.000Z");

    expect(meetingsConflict(a, b)).toBe(false);
  });

  it("does not flag two instants on the same UTC day but different local days", () => {
    // The trap a naive UTC-calendar-day comparison would fall into: both
    // instants fall on 2026-11-09 in UTC, but 00:15 local is already
    // 2026-11-10 in Asia/Jerusalem (UTC+2) — a different evening.
    const lateNightUtcDay = new Date("2026-11-09T22:15:00.000Z"); // 00:15 local, Nov 10
    const earlyEveningUtcDay = new Date("2026-11-09T21:00:00.000Z"); // 23:00 local, Nov 9

    expect(meetingsConflict(lateNightUtcDay, earlyEveningUtcDay)).toBe(false);
  });

  it("flags two instants on the same local day even though they cross UTC midnight", () => {
    // The inverse trap: 00:30 and 03:00 local (Nov 10) straddle UTC
    // midnight (22:30Z Nov 9 and 01:00Z Nov 10) but are the same evening
    // in Asia/Jerusalem.
    const justAfterLocalMidnight = new Date("2026-11-09T22:30:00.000Z"); // 00:30 local, Nov 10
    const localEarlyMorning = new Date("2026-11-10T01:00:00.000Z"); // 03:00 local, Nov 10

    expect(meetingsConflict(justAfterLocalMidnight, localEarlyMorning)).toBe(
      true
    );
  });

  it("does not flag two meetings on clearly different days", () => {
    const a = new Date("2026-11-10T19:00:00.000Z");
    const b = new Date("2026-11-11T19:00:00.000Z");

    expect(meetingsConflict(a, b)).toBe(false);
  });
});

describe("canonicalMeetingPair", () => {
  it("keeps an already-sorted pair as-is", () => {
    expect(canonicalMeetingPair("m1", "m2")).toEqual(["m1", "m2"]);
  });

  it("sorts a reversed pair into the same canonical order", () => {
    expect(canonicalMeetingPair("m2", "m1")).toEqual(["m1", "m2"]);
  });

  it("agrees with itself regardless of argument order", () => {
    expect(canonicalMeetingPair("cljabc123", "cljxyz789")).toEqual(
      canonicalMeetingPair("cljxyz789", "cljabc123")
    );
  });
});

/**
 * The availability arithmetic the follow-up harness rests on.
 *
 * A scenario states the group's free windows; a real run derives them from
 * calendars. `busyOutside` is the bridge — the busy blocks whose complement is
 * exactly the fixture's own availability — and `assembleRun` intersects them
 * back into the window it searched. If the two disagree, nothing fails: the
 * loop simply answers a different evening's question, and the verdict looks
 * just as green.
 *
 * No database and no key: this is the pure half of `evals/loop.ts`.
 */

import { describe, expect, it } from "vitest";

import { busyOutside } from "@/evals/loop";
import { commonFreeWindows } from "@/lib/matching/availability";
import type { Participant, TimeSlot } from "@/lib/types";

const at = (hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 8, 11, hour, minute));

const slot = (from: number, to: number): TimeSlot => ({
  start: at(from),
  end: at(to),
});

const reads = (slots: TimeSlot[]) =>
  slots.map(
    (one) => `${one.start.getUTCHours()}:00–${one.end.getUTCHours() || 24}:00`
  );

const WINDOW = slot(0, 24);

describe("busyOutside", () => {
  it("blocks everything on both sides of one free window", () => {
    expect(reads(busyOutside(WINDOW, [slot(13, 16)]))).toEqual([
      "0:00–13:00",
      "16:00–24:00",
    ]);
  });

  it("blocks the gap between two free windows", () => {
    expect(reads(busyOutside(WINDOW, [slot(9, 11), slot(13, 16)]))).toEqual([
      "0:00–9:00",
      "11:00–13:00",
      "16:00–24:00",
    ]);
  });

  it("does not care what order the free windows arrive in", () => {
    expect(busyOutside(WINDOW, [slot(13, 16), slot(9, 11)])).toEqual(
      busyOutside(WINDOW, [slot(9, 11), slot(13, 16)])
    );
  });

  it("blocks the whole window when nothing is free", () => {
    expect(reads(busyOutside(WINDOW, []))).toEqual(["0:00–24:00"]);
  });

  it("blocks nothing when the window is free end to end", () => {
    expect(busyOutside(WINDOW, [slot(0, 24)])).toEqual([]);
  });

  it("emits no zero-length block where a free window meets an edge", () => {
    // A block of no duration is not wrong so much as noise that a later
    // intersection has to carry and that a reader has to explain.
    expect(reads(busyOutside(WINDOW, [slot(0, 16)]))).toEqual(["16:00–24:00"]);
    expect(reads(busyOutside(WINDOW, [slot(13, 24)]))).toEqual(["0:00–13:00"]);
  });

  it("treats overlapping free windows as their union, not as two", () => {
    expect(reads(busyOutside(WINDOW, [slot(9, 14), slot(11, 16)]))).toEqual([
      "0:00–9:00",
      "16:00–24:00",
    ]);
  });

  /**
   * The round trip, which is the only claim that matters: what a scenario
   * states is what the run ends up searching.
   */
  it("returns the fixture's own evening back through commonFreeWindows", () => {
    const free = [slot(13, 16)];
    const busy = busyOutside(WINDOW, free);

    const participants = ["Idan", "Michal", "Oren"].map(
      (name) => ({ userId: name, busy }) as unknown as Participant
    );

    expect(reads(commonFreeWindows(participants, WINDOW))).toEqual([
      "13:00–16:00",
    ]);
  });
});

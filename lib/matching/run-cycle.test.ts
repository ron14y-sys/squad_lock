import { describe, expect, it } from "vitest";

import {
  blockedByRejections,
  searchWindow,
  type PriorProposal,
  type RecordedRejection,
} from "./run-cycle";
import { pairId } from "./schemas";

/**
 * A8b's two rules, with no database and no clock.
 *
 * The scenario throughout is one meeting: the group is offered Asian at
 * 20:00, somebody says no, they are offered Italian at 20:00, somebody says
 * no again. What may the third proposal contain?
 */

const at = (iso: string) => new Date(iso);

const EVENING = {
  start: at("2026-09-24T17:00:00.000Z"),
  end: at("2026-09-24T20:00:00.000Z"),
};
const LATER = {
  start: at("2026-09-24T20:00:00.000Z"),
  end: at("2026-09-24T23:00:00.000Z"),
};

const asian: PriorProposal = {
  at: at("2026-09-24T15:00:00.000Z"),
  placeId: "asian",
  slot: EVENING,
};
const italian: PriorProposal = {
  at: at("2026-09-24T16:00:00.000Z"),
  placeId: "italian",
  slot: EVENING,
};

const rejection = (
  iso: string,
  outcome: RecordedRejection["outcome"]
): RecordedRejection => ({ at: at(iso), outcome });

describe("blockedByRejections", () => {
  it("blocks nothing on a meeting with no history", () => {
    const blocked = blockedByRejections([], []);

    expect(blocked.venues.size).toBe(0);
    expect(blocked.pairs.size).toBe(0);
  });

  // #17: "the option just rejected may not be re-proposed". Doing it for
  // every earlier proposal costs nothing and closes the case where one comes
  // back two cycles later as though nobody had said anything.
  it("never repeats a proposal, whichever cycle it was made in", () => {
    const blocked = blockedByRejections([asian, italian], []);

    expect([...blocked.pairs]).toEqual([
      pairId("asian", EVENING),
      pairId("italian", EVENING),
    ]);
  });

  it("blocks the whole venue when the objection was the venue itself", () => {
    const blocked = blockedByRejections(
      [asian],
      [rejection("2026-09-24T15:30:00.000Z", "venue_identity")]
    );

    expect(blocked.venues.has("asian")).toBe(true);
  });

  // "Too loud" and "too expensive" are properties of the place. Offering it
  // again three hours earlier does not answer the objection.
  it("blocks the whole venue for a soft objection too", () => {
    const blocked = blockedByRejections(
      [asian],
      [rejection("2026-09-24T15:30:00.000Z", "soft")]
    );

    expect(blocked.venues.has("asian")).toBe(true);
  });

  // The opposite case, and the reason the rule is not just "block the
  // venue": the same venue earlier is exactly the right next answer.
  it("leaves the venue open when the objection was the hour", () => {
    const blocked = blockedByRejections(
      [{ ...asian, slot: LATER }],
      [rejection("2026-09-24T15:30:00.000Z", "time")]
    );

    expect(blocked.venues.size).toBe(0);
    expect(blocked.pairs.has(pairId("asian", LATER))).toBe(true);
    expect(blocked.pairs.has(pairId("asian", EVENING))).toBe(false);
  });

  // Reach varies by hour — "no car after 21:00" (#89) — so "too far" is the
  // other objection that is about the evening rather than the place.
  it("leaves the venue open for a distance objection", () => {
    const blocked = blockedByRejections(
      [asian],
      [rejection("2026-09-24T15:30:00.000Z", "distance")]
    );

    expect(blocked.venues.size).toBe(0);
  });

  it("blocks only the pair when nothing was understood", () => {
    for (const outcome of [
      "none",
      "failed_quota",
      "failed_call",
      null,
    ] as const) {
      const blocked = blockedByRejections(
        [asian],
        [rejection("2026-09-24T15:30:00.000Z", outcome)]
      );

      expect(blocked.venues.size, `outcome ${outcome}`).toBe(0);
      expect(blocked.pairs.has(pairId("asian", EVENING))).toBe(true);
    }
  });

  // The whole reason the outcome is stored per row rather than read off
  // Response.extractionOutcome, which only ever holds the last one: each
  // rejection is about whatever was on screen when it was written.
  it("blocks the venue that was on screen, not the newest one", () => {
    const blocked = blockedByRejections(
      [asian, italian],
      [
        rejection("2026-09-24T15:30:00.000Z", "venue_identity"),
        rejection("2026-09-24T16:30:00.000Z", "venue_identity"),
      ]
    );

    expect([...blocked.venues].sort()).toEqual(["asian", "italian"]);
  });

  // Ron's scenario: "no Asian" in cycle 1, "no Italian" in cycle 2. The
  // third proposal may be neither — before A8 the first sentence had been
  // overwritten in the database and Asian could come back.
  it("keeps cycle 1's venue blocked through cycle 3", () => {
    const blocked = blockedByRejections(
      [asian, italian],
      [
        rejection("2026-09-24T15:30:00.000Z", "venue_identity"),
        rejection("2026-09-24T16:30:00.000Z", "venue_identity"),
      ]
    );

    expect(blocked.venues.has("asian")).toBe(true);
  });
});

describe("searchWindow", () => {
  const NOW = at("2026-09-20T09:00:00.000Z");

  it("looks a week ahead when no date was pinned", () => {
    const window = searchWindow(null, NOW);

    expect(window.start).toEqual(NOW);
    expect(window.end.getTime() - NOW.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  // A @db.Date is midnight UTC on that calendar day; Asia/Jerusalem is two
  // or three hours ahead, so the local day starts before that instant.
  it("covers the pinned day in APP_TIME_ZONE, not the UTC one", () => {
    const window = searchWindow(at("2026-09-24T00:00:00.000Z"), NOW);

    expect(window.start.toISOString()).toBe("2026-09-23T21:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-09-24T21:00:00.000Z");
  });

  it("does not propose a pinned day's hours that have already passed", () => {
    const midday = at("2026-09-24T09:00:00.000Z");
    const window = searchWindow(at("2026-09-24T00:00:00.000Z"), midday);

    expect(window.start).toEqual(midday);
  });
});

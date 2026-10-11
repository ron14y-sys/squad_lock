import { describe, expect, it } from "vitest";

import {
  RECENT_VENUES_SHOWN,
  recentSince,
  recentVenuesOf,
  type PastMeeting,
} from "./recent";

const NOW = new Date("2026-10-11T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

function meeting(
  ...runs: { at: Date; venues: [string | null, string][] }[]
): PastMeeting {
  return {
    matchRuns: runs.map((run) => ({
      createdAt: run.at,
      options: run.venues.map(([venuePlaceId, venueName]) => ({
        venuePlaceId,
        venueName,
      })),
    })),
  };
}

describe("recentVenuesOf (#213)", () => {
  it("is empty for a group with no history", () => {
    expect(recentVenuesOf([], NOW)).toEqual([]);
  });

  it("lists the top proposals of the last 30 days, newest first", () => {
    const venues = recentVenuesOf(
      [
        meeting({ at: daysAgo(10), venues: [["a", "Aroma"]] }),
        meeting({ at: daysAgo(2), venues: [["b", "Bar"]] }),
      ],
      NOW
    );
    expect(venues).toEqual([
      { placeId: "b", name: "Bar" },
      { placeId: "a", name: "Aroma" },
    ]);
  });

  it("ignores a run older than the window, and counts one just inside it", () => {
    const venues = recentVenuesOf(
      [
        meeting(
          { at: daysAgo(31), venues: [["old", "Old"]] },
          { at: daysAgo(29), venues: [["new", "New"]] }
        ),
      ],
      NOW
    );
    expect(venues.map((v) => v.placeId)).toEqual(["new"]);
  });

  it("names a place once even when it came up in several meetings", () => {
    const venues = recentVenuesOf(
      [
        meeting({ at: daysAgo(3), venues: [["a", "Aroma"]] }),
        meeting({ at: daysAgo(8), venues: [["a", "Aroma"]] }),
      ],
      NOW
    );
    expect(venues).toEqual([{ placeId: "a", name: "Aroma" }]);
  });

  it("leaves out a venue that never resolved to a place", () => {
    const venues = recentVenuesOf(
      [meeting({ at: daysAgo(1), venues: [[null, "Somewhere typed"]] })],
      NOW
    );
    expect(venues).toEqual([]);
  });

  it("caps how many names it hands on, keeping the newest", () => {
    const runs = Array.from({ length: RECENT_VENUES_SHOWN + 3 }, (_, i) => ({
      at: daysAgo(i + 1),
      venues: [[`p${i}`, `Venue ${i}`]] as [string, string][],
    }));
    const venues = recentVenuesOf([meeting(...runs)], NOW);
    expect(venues).toHaveLength(RECENT_VENUES_SHOWN);
    expect(venues[0].placeId).toBe("p0");
  });
});

describe("recentSince", () => {
  it("is thirty days before now by default", () => {
    expect(recentSince(NOW).toISOString()).toBe("2026-09-11T12:00:00.000Z");
  });
});

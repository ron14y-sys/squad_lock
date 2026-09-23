import { describe, expect, it } from "vitest";

import type {
  Candidate,
  LatLng,
  Participant,
  PreferenceProfile,
  TimeSlot,
} from "@/lib/types";
import { buildShortlist, BURDEN_GATE_T, dedupeCandidates } from "./funnel";

/**
 * Same fixture shapes as `lib/matching/distance.test.ts` and
 * `lib/matching/availability.test.ts` — real coordinates rather than
 * invented ones, so a burden number here means the same thing it means
 * there.
 */

const ROTHSCHILD: LatLng = { lat: 32.0648, lng: 34.7749 };
const JERUSALEM: LatLng = { lat: 31.7683, lng: 35.2137 }; // ~53 km from Rothschild

const slot = (startIso: string, endIso: string): TimeSlot => ({
  start: new Date(startIso),
  end: new Date(endIso),
});

const THREE_HOUR_WINDOW = slot(
  "2026-09-07T16:00:00.000Z",
  "2026-09-07T19:00:00.000Z"
);
const TOO_SHORT_WINDOW = slot(
  "2026-09-07T16:00:00.000Z",
  "2026-09-07T17:00:00.000Z"
); // 1h, under MINIMUM_MEETING_MINUTES

function profile(
  overrides: Partial<PreferenceProfile> = {}
): PreferenceProfile {
  return {
    id: "p1",
    userId: "u1",
    hardConstraints: { dietary: [], allergies: [], unavailable: [] },
    softPreferences: {},
    home: ROTHSCHILD,
    homeNeighbourhood: "Rothschild",
    toleranceKm: 8,
    recurringMobilityRules: [],
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  };
}

function participant(
  userId: string,
  name: string,
  origin: LatLng = ROTHSCHILD,
  toleranceKm = 8
): Participant {
  return {
    userId,
    name,
    profile: profile({ id: `profile-${userId}`, userId, toleranceKm }),
    context: null,
    origin,
    busy: [],
  };
}

function candidate(placeId: string, location: LatLng = ROTHSCHILD): Candidate {
  return {
    placeId,
    name: placeId,
    address: null,
    location,
    neighbourhood: null,
  };
}

describe("dedupeCandidates", () => {
  it("keeps the first occurrence of each placeId, in order", () => {
    const a1 = candidate("place-a", ROTHSCHILD);
    const b = candidate("place-b", JERUSALEM);
    const a2 = candidate("place-a", JERUSALEM); // same id, different object

    expect(dedupeCandidates([a1, b, a2])).toEqual([a1, b]);
  });

  it("is empty for an empty pool", () => {
    expect(dedupeCandidates([])).toEqual([]);
  });

  it("changes nothing when there are no duplicates", () => {
    const pool = [candidate("p1"), candidate("p2"), candidate("p3")];
    expect(dedupeCandidates(pool)).toEqual(pool);
  });
});

describe("buildShortlist", () => {
  it("puts a candidate with zero burden for everyone in the shortlist", () => {
    const dana = participant("u-dana", "Dana", ROTHSCHILD);
    const cafe = candidate("place-1", ROTHSCHILD); // same point — zero distance

    const result = buildShortlist({
      candidates: [cafe],
      participants: [dana],
      slots: [THREE_HOUR_WINDOW],
    });

    expect(result.shortlist.map((s) => s.candidate.placeId)).toEqual([
      "place-1",
    ]);
    expect(result.gatedOut).toEqual([]);
  });

  it("gates out a candidate whose burden clearly exceeds T, for a low-tolerance participant far away", () => {
    // ~53 km apart, tolerance 5 km -> burden ~10.6, well past BURDEN_GATE_T (2.0).
    const dana = participant("u-dana", "Dana", ROTHSCHILD, 5);
    const farVenue = candidate("place-far", JERUSALEM);

    const result = buildShortlist({
      candidates: [farVenue],
      participants: [dana],
      slots: [THREE_HOUR_WINDOW],
    });

    expect(result.shortlist).toEqual([]);
    expect(result.gatedOut).toHaveLength(1);
    expect(result.gatedOut[0].candidate.placeId).toBe("place-far");
    expect(result.gatedOut[0].leximin[0]).toBeGreaterThan(BURDEN_GATE_T);
  });

  it("keeps a candidate whose burden is comfortably under T for every participant, even a far one with generous tolerance", () => {
    // Same ~53 km, but tolerance 100 km -> burden ~0.53, comfortably under 2.0.
    const dana = participant("u-dana", "Dana", ROTHSCHILD, 100);
    const venue = candidate("place-1", JERUSALEM);

    const result = buildShortlist({
      candidates: [venue],
      participants: [dana],
      slots: [THREE_HOUR_WINDOW],
    });

    expect(result.shortlist.map((s) => s.candidate.placeId)).toEqual([
      "place-1",
    ]);
  });

  it("gates on the worst-off participant, not the average", () => {
    // Dana is right there (burden ~0); Yoav is far with a tight tolerance
    // (burden well past T). One bad participant is enough to gate the venue.
    const dana = participant("u-dana", "Dana", ROTHSCHILD, 8);
    const yoav = participant("u-yoav", "Yoav", JERUSALEM, 2);
    const venue = candidate("place-1", ROTHSCHILD);

    const result = buildShortlist({
      candidates: [venue],
      participants: [dana, yoav],
      slots: [THREE_HOUR_WINDOW],
    });

    expect(result.shortlist).toEqual([]);
    expect(result.gatedOut).toHaveLength(1);
  });

  it("dedupes the input pool before ranking — one shortlist entry, not two, for the same placeId from two search centres", () => {
    const dana = participant("u-dana", "Dana", ROTHSCHILD);
    const seenTwice = [
      candidate("place-1", ROTHSCHILD),
      candidate("place-1", ROTHSCHILD),
    ];

    const result = buildShortlist({
      candidates: seenTwice,
      participants: [dana],
      slots: [THREE_HOUR_WINDOW],
    });

    expect(result.shortlist).toHaveLength(1);
  });

  it("ranks the fairer candidate first", () => {
    const dana = participant("u-dana", "Dana", ROTHSCHILD, 100);
    const near = candidate("place-near", ROTHSCHILD); // zero burden
    const far = candidate("place-far", JERUSALEM); // small but nonzero burden

    const result = buildShortlist({
      candidates: [far, near], // deliberately out of fairness order
      participants: [dana],
      slots: [THREE_HOUR_WINDOW],
    });

    expect(result.shortlist.map((s) => s.candidate.placeId)).toEqual([
      "place-near",
      "place-far",
    ]);
  });

  it("caps the shortlist at SHORTLIST_SIZE, keeping the fairest", () => {
    const dana = participant("u-dana", "Dana", ROTHSCHILD, 100);
    // 30 candidates at slightly different points, all comfortably under the
    // gate, so every one of them survives filtering — only the cap decides
    // which 24 make it.
    const candidates = Array.from({ length: 30 }, (_, i) =>
      candidate(`place-${i}`, { lat: 32.0648 + i * 0.0001, lng: 34.7749 })
    );

    const result = buildShortlist({
      candidates,
      participants: [dana],
      slots: [THREE_HOUR_WINDOW],
    });

    expect(result.shortlist).toHaveLength(24);
  });

  it("surfaces a dropped pair (too short a window) in droppedPairs, and excludes it from both the shortlist and gatedOut", () => {
    const dana = participant("u-dana", "Dana", ROTHSCHILD);
    const venue = candidate("place-1", ROTHSCHILD);

    const result = buildShortlist({
      candidates: [venue],
      participants: [dana],
      slots: [TOO_SHORT_WINDOW],
    });

    expect(result.shortlist).toEqual([]);
    expect(result.gatedOut).toEqual([]);
    expect(result.droppedPairs.length).toBeGreaterThan(0);
  });

  it("is an empty shortlist, not a crash, for no candidates at all", () => {
    const dana = participant("u-dana", "Dana", ROTHSCHILD);

    const result = buildShortlist({
      candidates: [],
      participants: [dana],
      slots: [THREE_HOUR_WINDOW],
    });

    expect(result.shortlist).toEqual([]);
    expect(result.gatedOut).toEqual([]);
    expect(result.droppedPairs).toEqual([]);
  });
});

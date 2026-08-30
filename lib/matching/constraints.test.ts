import { describe, expect, it } from "vitest";

import type {
  Candidate,
  LocalWindow,
  Participant,
  PreferenceProfile,
  TimeSlot,
} from "@/lib/types";
import {
  assertChosenPairAllowed,
  checkChosenPair,
  filterPairs,
  HardConstraintError,
  minutesOfDay,
  slotOverlapsWindow,
  viableSlotsByCandidate,
  windowsCoverSlot,
  type ConstraintInput,
} from "./constraints";

/**
 * Every instant below is written as UTC and annotated with what it is in
 * `Asia/Jerusalem`, because that is the only reading that matters here. The
 * zone is UTC+3 in September and July, UTC+2 in January — which is the whole
 * reason `slotOverlapsWindow` goes through `Intl` rather than arithmetic.
 */
const slot = (startIso: string, endIso: string): TimeSlot => ({
  start: new Date(startIso),
  end: new Date(endIso),
});

/** Monday 7 Sep 2026, 19:00–21:00 local. The default proposed slot. */
const MON_EVENING = slot(
  "2026-09-07T16:00:00.000Z",
  "2026-09-07T18:00:00.000Z"
);
/** Monday 7 Sep 2026, 15:00–17:00 local. The same day, earlier. */
const MON_AFTERNOON = slot(
  "2026-09-07T12:00:00.000Z",
  "2026-09-07T14:00:00.000Z"
);
/** Friday 11 Sep 2026, 20:00–22:00 local. */
const FRI_EVENING = slot(
  "2026-09-11T17:00:00.000Z",
  "2026-09-11T19:00:00.000Z"
);

/** A profile with nothing objectionable in it. Override the one field under test. */
function profile(
  overrides: Partial<PreferenceProfile> = {}
): PreferenceProfile {
  return {
    id: "p1",
    userId: "u1",
    hardConstraints: { dietary: [], allergies: [], unavailable: [] },
    softPreferences: {
      noiseLevel: "quiet",
      activityStyle: "cultural",
      budget: "modest",
      cuisine: "familiar",
    },
    home: { lat: 32.08, lng: 34.78 },
    homeNeighbourhood: "Florentin",
    toleranceKm: 8,
    recurringMobilityRules: [],
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

/** A participant at home in Florentin, free all week, able to travel. */
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

/** A venue with no opening hours and no rating — the plainest candidate there is. */
function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    placeId: "v1",
    name: "Café Levinsky",
    address: "Levinsky 40",
    location: { lat: 32.06, lng: 34.77 },
    neighbourhood: "Florentin",
    ...overrides,
  };
}

/** One venue, one slot, one person with nothing against either. */
function input(overrides: Partial<ConstraintInput> = {}): ConstraintInput {
  return {
    candidates: [candidate()],
    participants: [participant("u1", "Dana")],
    slots: [MON_EVENING],
    ...overrides,
  };
}

describe("local windows against instants", () => {
  it("reads HH:MM, and refuses anything else", () => {
    expect(minutesOfDay("18:00")).toBe(1080);
    expect(minutesOfDay("00:00")).toBe(0);
    expect(() => minutesOfDay("6pm")).toThrow(/HH:MM/);
    expect(() => minutesOfDay("24:00")).toThrow(/HH:MM/);
  });

  it("matches the same wall-clock window in summer and in winter", () => {
    // 18:30 local both times, but 15:30Z in July and 16:30Z in January.
    // Arithmetic on the UTC value gets one of these two wrong; `Intl` does not.
    const window: LocalWindow = {
      weekdays: ["monday"],
      from: "18:00",
      to: "21:00",
    };
    const july = slot("2026-07-13T15:30:00.000Z", "2026-07-13T16:30:00.000Z");
    const january = slot(
      "2026-01-12T16:30:00.000Z",
      "2026-01-12T17:30:00.000Z"
    );

    expect(slotOverlapsWindow(july, window)).toBe(true);
    expect(slotOverlapsWindow(january, window)).toBe(true);
  });

  it("catches a window that sits entirely inside a long slot", () => {
    // The trap that endpoint-sampling misses: neither end of the slot is in
    // the window, but the middle of it is.
    const window: LocalWindow = {
      weekdays: ["monday"],
      from: "18:00",
      to: "21:00",
    };
    const allDay = slot("2026-09-07T09:00:00.000Z", "2026-09-07T20:00:00.000Z");

    expect(slotOverlapsWindow(allDay, window)).toBe(true);
  });

  it("handles a window and a slot that both cross midnight", () => {
    // Saturday 23:00 to Sunday 01:00 local — the axis wraps here.
    const saturdayNight = slot(
      "2026-09-12T20:00:00.000Z",
      "2026-09-12T22:00:00.000Z"
    );
    const late: LocalWindow = {
      weekdays: ["saturday"],
      from: "22:00",
      to: "02:00",
    };

    expect(slotOverlapsWindow(saturdayNight, late)).toBe(true);
    expect(windowsCoverSlot([late], saturdayNight)).toBe(true);
  });

  it("does not call a slot covered when it spans the gap between two sittings", () => {
    const lunch: LocalWindow = { weekdays: [], from: "12:00", to: "16:00" };
    const dinner: LocalWindow = { weekdays: [], from: "18:00", to: "23:00" };
    const across = slot("2026-09-07T12:00:00.000Z", "2026-09-07T17:00:00.000Z");

    expect(windowsCoverSlot([lunch, dinner], across)).toBe(false);
    expect(windowsCoverSlot([lunch, dinner], MON_EVENING)).toBe(true);
  });
});

describe("the filter, before the agent", () => {
  it("removes the best-rated venue in the pool when it breaks a hard constraint", () => {
    // The §9 trap: perfect on every other axis, and still not the answer.
    const result = filterPairs(
      input({
        candidates: [
          candidate({ placeId: "v1", name: "Best in town", rating: 4.9 }),
        ],
        participants: [
          participant("u1", "Dana", {
            profile: profile({
              hardConstraints: {
                dietary: ["Kosher"],
                allergies: [],
                unavailable: [],
              },
            }),
          }),
        ],
        venueFacts: { v1: { violates: ["kosher"] } },
      })
    );

    expect(result.viable).toHaveLength(0);
    expect(result.dropped[0].violations[0]).toMatchObject({
      kind: "dietary",
      participantId: "u1",
    });
  });

  it("removes a venue closed at the proposed hour, and keeps it at another", () => {
    const result = filterPairs(
      input({
        candidates: [
          candidate({
            openingHours: [{ weekdays: [], from: "12:00", to: "18:00" }],
          }),
        ],
        slots: [MON_AFTERNOON, MON_EVENING],
      })
    );

    expect(result.viable).toHaveLength(1);
    expect(result.viable[0].slot).toBe(MON_AFTERNOON);
    expect(result.dropped[0].violations[0].kind).toBe("closed");
  });

  it("keeps a venue whose hours we never fetched, and says they are unverified", () => {
    // Hours are an Enterprise-tier field (spec §5.4, §13.7). Dropping on
    // ignorance would shrink the pool to whatever we happened to pay for.
    const result = filterPairs(input());

    expect(result.viable).toHaveLength(1);
    expect(result.viable[0].unverified).toContainEqual({
      kind: "opening_hours",
    });
  });

  it("reports an unchecked dietary tag once, however many people share it", () => {
    const kosher = { dietary: ["kosher"], allergies: [], unavailable: [] };
    const result = filterPairs(
      input({
        participants: [
          participant("u1", "Dana", {
            profile: profile({ hardConstraints: kosher }),
          }),
          participant("u2", "Noa", {
            profile: profile({ hardConstraints: kosher }),
          }),
        ],
      })
    );

    expect(
      result.viable[0].unverified.filter((f) => f.kind === "dietary")
    ).toEqual([{ kind: "dietary", tag: "kosher" }]);
  });

  it("stops reporting a tag once the venue is known to satisfy it", () => {
    const result = filterPairs(
      input({
        participants: [
          participant("u1", "Dana", {
            profile: profile({
              hardConstraints: {
                dietary: ["kosher"],
                allergies: [],
                unavailable: [],
              },
            }),
          }),
        ],
        venueFacts: { v1: { satisfies: ["Kosher"] } },
      })
    );

    expect(result.viable[0].unverified).not.toContainEqual({
      kind: "dietary",
      tag: "kosher",
    });
  });

  it("drops a slot one person has a calendar block over", () => {
    const result = filterPairs(
      input({
        participants: [
          participant("u1", "Dana"),
          participant("u2", "Noa", {
            busy: [
              slot("2026-09-07T17:00:00.000Z", "2026-09-07T19:00:00.000Z"),
            ],
          }),
        ],
      })
    );

    expect(result.viable).toHaveLength(0);
    expect(result.dropped[0].violations[0]).toMatchObject({
      kind: "busy",
      participantId: "u2",
    });
  });

  it("drops a slot inside somebody's fixed unavailable hours", () => {
    const result = filterPairs(
      input({
        participants: [
          participant("u1", "Dana", {
            profile: profile({
              hardConstraints: {
                dietary: [],
                allergies: [],
                unavailable: [
                  { weekdays: ["monday"], from: "20:00", to: "23:00" },
                ],
              },
            }),
          }),
        ],
      })
    );

    expect(result.dropped[0].violations[0].kind).toBe("unavailable");
  });

  it("drops a slot where somebody has no way of travelling at all", () => {
    const stranded = participant("u1", "Dana", {
      profile: profile({
        recurringMobilityRules: [
          { kind: "mode_unavailable", weekdays: ["friday"], mode: "car" },
        ],
      }),
      context: {
        id: "c1",
        meetingId: "m1",
        userId: "u1",
        origin: null,
        originLabel: null,
        mobilityWindows: [
          {
            mode: "transit",
            available: false,
            window: { weekdays: ["friday"], from: "19:00", to: "23:59" },
          },
          {
            mode: "walk",
            available: false,
            window: { weekdays: ["friday"], from: "19:00", to: "23:59" },
          },
        ],
        note: null,
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
      },
    });

    const result = filterPairs(
      input({ participants: [stranded], slots: [FRI_EVENING] })
    );

    expect(result.dropped[0].violations[0].kind).toBe("immobile");
  });

  it("lets tonight's amendment overrule the standing rule, not the other way round", () => {
    // "No car on Fridays" is the profile; "I have the car tonight" is the
    // amendment, and spec §5.7 says the amendment wins.
    const borrowed = participant("u1", "Dana", {
      profile: profile({
        recurringMobilityRules: [
          { kind: "mode_unavailable", weekdays: ["friday"], mode: "car" },
          { kind: "mode_unavailable", weekdays: ["friday"], mode: "transit" },
          { kind: "mode_unavailable", weekdays: ["friday"], mode: "walk" },
        ],
      }),
      context: {
        id: "c1",
        meetingId: "m1",
        userId: "u1",
        origin: null,
        originLabel: null,
        mobilityWindows: [
          {
            mode: "car",
            available: true,
            window: { weekdays: ["friday"], from: "18:00", to: "23:59" },
          },
        ],
        note: "borrowed the car",
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
      },
    });

    const result = filterPairs(
      input({ participants: [borrowed], slots: [FRI_EVENING] })
    );

    expect(result.viable).toHaveLength(1);
  });

  it("groups the surviving slots by venue, the way the shortlist wants them", () => {
    const result = filterPairs(
      input({
        candidates: [
          candidate({ placeId: "v1" }),
          candidate({ placeId: "v2" }),
        ],
        slots: [MON_AFTERNOON, MON_EVENING],
      })
    );

    const byCandidate = viableSlotsByCandidate(result);
    expect(byCandidate.get("v1")).toEqual([MON_AFTERNOON, MON_EVENING]);
    expect(byCandidate.get("v2")).toHaveLength(2);
  });
});

describe("the post-check, after the agent", () => {
  it("catches a venue the agent invented", () => {
    const violations = checkChosenPair(
      { candidatePlaceId: "somewhere-lovely", slot: MON_EVENING },
      input()
    );

    expect(violations[0].kind).toBe("not_a_candidate");
  });

  it("catches a slot that was never offered", () => {
    const violations = checkChosenPair(
      { candidatePlaceId: "v1", slot: MON_AFTERNOON },
      input()
    );

    expect(violations[0].kind).toBe("slot_not_offered");
  });

  it("catches an answer that breaks a constraint the filter had already removed", () => {
    // The failure this whole file exists for: the agent was shown a legal
    // pair and returned an illegal one anyway.
    const withTrap = input({
      candidates: [
        candidate({ placeId: "v1" }),
        candidate({ placeId: "v2", name: "Not kosher" }),
      ],
      participants: [
        participant("u1", "Dana", {
          profile: profile({
            hardConstraints: {
              dietary: ["kosher"],
              allergies: [],
              unavailable: [],
            },
          }),
        }),
      ],
      venueFacts: { v2: { violates: ["kosher"] } },
    });

    expect(() =>
      assertChosenPairAllowed(
        { candidatePlaceId: "v2", slot: MON_EVENING },
        withTrap
      )
    ).toThrow(HardConstraintError);
  });

  it("carries the findings on the error, so a caller can log what went wrong", () => {
    try {
      assertChosenPairAllowed(
        { candidatePlaceId: "invented", slot: MON_EVENING },
        input()
      );
      expect.unreachable("the post-check should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(HardConstraintError);
      expect((error as HardConstraintError).violations).toHaveLength(1);
      expect((error as HardConstraintError).message).toMatch(
        /not in the shortlist/
      );
    }
  });

  it("passes a pair that is genuinely fine", () => {
    expect(() =>
      assertChosenPairAllowed(
        { candidatePlaceId: "v1", slot: MON_EVENING },
        input()
      )
    ).not.toThrow();
  });
});

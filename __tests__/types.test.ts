import { describe, expect, it } from "vitest";

import type {
  MeetingStatus as PrismaMeetingStatus,
  ResponseStatus as PrismaResponseStatus,
} from "@/lib/generated/prisma/enums";
import type {
  MeetingModel,
  ParticipantMeetingContextModel,
  PreferenceProfileModel,
} from "@/lib/generated/prisma/models";
import {
  meetingFromRow,
  mergeContexts,
  participantMeetingContextFromRow,
  preferenceProfileFromRow,
  type MeetingStatus,
  type ResponseStatus,
} from "@/lib/types";

/**
 * ---------------------------------------------------------------------------
 * Drift guards — these run at type-check time, not at run time
 * ---------------------------------------------------------------------------
 *
 * `MeetingStatus` and `ResponseStatus` are hand-written in `lib/types` and also
 * generated from `schema.prisma`. Nothing connects the two, so adding a status
 * to the database and forgetting the type would be silent — right up until a
 * `switch` somewhere quietly stopped covering a case.
 *
 * The assertions below make `npm run typecheck` fail instead. They are the
 * lesson of #71 applied to a contract rather than a build step: a guarantee
 * nothing exercises is not working, it is merely untested.
 *
 * These are exported so they count as used. They compile to nothing.
 */

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

type Assert<T extends true> = T;

export type MeetingStatusMatchesPrisma = Assert<
  Equals<MeetingStatus, PrismaMeetingStatus>
>;

export type ResponseStatusMatchesPrisma = Assert<
  Equals<ResponseStatus, PrismaResponseStatus>
>;

/**
 * ---------------------------------------------------------------------------
 * The converter
 * ---------------------------------------------------------------------------
 */

const PINNED_DATE = new Date("2026-09-03T00:00:00.000Z");

/** `satisfies` rather than a cast, so a new column breaks this instead of being ignored. */
function row(overrides: Partial<MeetingModel> = {}): MeetingModel {
  return {
    id: "m1",
    groupId: "g1",
    initiatorId: "u1",
    status: "weighing",
    cycleCount: 0,
    pinnedDate: null,
    pinnedTime: null,
    pinnedVenue: null,
    occasion: null,
    currentDatetime: null,
    runStage: null,
    createdAt: new Date("2026-08-27T09:00:00.000Z"),
    updatedAt: new Date("2026-08-27T09:00:00.000Z"),
    ...overrides,
  } satisfies MeetingModel;
}

describe("meetingFromRow", () => {
  it("composes the two pinned columns into one value", () => {
    const meeting = meetingFromRow(
      row({ pinnedDate: PINNED_DATE, pinnedTime: "19:30" })
    );

    expect(meeting.pinnedWhen).toEqual({
      kind: "date_and_time",
      date: "2026-09-03",
      time: "19:30",
    });
  });

  it("reads a date-only pin as a date, never as midnight", () => {
    // The trap this exists to catch: turning a day with no chosen time into
    // 00:00 gives every downstream stage a time the initiator never picked.
    const meeting = meetingFromRow(row({ pinnedDate: PINNED_DATE }));

    expect(meeting.pinnedWhen).toEqual({ kind: "date", date: "2026-09-03" });
    expect(JSON.stringify(meeting.pinnedWhen)).not.toContain("00:00");
  });

  it("keeps the calendar day the database stored, not the day in local time", () => {
    // A `@db.Date` column comes back as UTC midnight. Reading it with local
    // getters shifts the day for anyone east of Greenwich — which is everyone
    // this app is for.
    const meeting = meetingFromRow(
      row({ pinnedDate: new Date("2026-01-01T00:00:00.000Z") })
    );

    expect(meeting.pinnedWhen).toEqual({ kind: "date", date: "2026-01-01" });
  });

  it("treats nothing pinned as nothing pinned", () => {
    // The all-blank case is the default path, not a degraded one (spec §3).
    expect(meetingFromRow(row()).pinnedWhen).toBeNull();
  });

  it("ignores a time with no date, because it schedules nothing", () => {
    expect(meetingFromRow(row({ pinnedTime: "19:30" })).pinnedWhen).toBeNull();
  });

  it("carries the rest of the row through unchanged", () => {
    const meeting = meetingFromRow(
      row({
        status: "stuck",
        cycleCount: 3,
        occasion: "Dana's birthday",
        pinnedVenue: "somewhere with outdoor seating",
        currentDatetime: new Date("2026-09-03T16:30:00.000Z"),
      })
    );

    expect(meeting.status).toBe("stuck");
    expect(meeting.cycleCount).toBe(3);
    expect(meeting.occasion).toBe("Dana's birthday");
    expect(meeting.pinnedVenue).toBe("somewhere with outdoor seating");
    expect(meeting.currentDatetime).toEqual(
      new Date("2026-09-03T16:30:00.000Z")
    );
  });
});

/**
 * ---------------------------------------------------------------------------
 * preferenceProfileFromRow
 * ---------------------------------------------------------------------------
 */

function preferenceProfileRow(
  overrides: Partial<PreferenceProfileModel> = {}
): PreferenceProfileModel {
  return {
    id: "pp1",
    userId: "u1",
    hardConstraints: { dietary: [], allergies: [], unavailable: [] },
    softPreferences: {
      noiseLevel: "quiet",
      activityStyle: "cultural",
      budget: "modest",
      cuisine: "familiar",
    },
    homeLat: null,
    homeLng: null,
    homeNeighbourhood: null,
    toleranceKm: 5,
    recurringMobilityRules: [],
    createdAt: new Date("2026-08-27T09:00:00.000Z"),
    updatedAt: new Date("2026-08-27T09:00:00.000Z"),
    ...overrides,
  } satisfies PreferenceProfileModel;
}

describe("preferenceProfileFromRow", () => {
  it("composes the two home columns into one LatLng", () => {
    const profile = preferenceProfileFromRow(
      preferenceProfileRow({ homeLat: 32.08, homeLng: 34.78 })
    );

    expect(profile.home).toEqual({ lat: 32.08, lng: 34.78 });
  });

  it("treats an unset home as null, not as (0, 0)", () => {
    // The Prisma defaults for homeLat/homeLng are both null together (no
    // home set during onboarding yet) — this must not read as the equator.
    expect(preferenceProfileFromRow(preferenceProfileRow()).home).toBeNull();
  });

  it("carries the rest of the row through unchanged", () => {
    const profile = preferenceProfileFromRow(
      preferenceProfileRow({
        homeNeighbourhood: "Florentin",
        toleranceKm: 12,
        hardConstraints: {
          dietary: ["kosher"],
          allergies: ["peanuts"],
          unavailable: [],
        },
      })
    );

    expect(profile.homeNeighbourhood).toBe("Florentin");
    expect(profile.toleranceKm).toBe(12);
    expect(profile.hardConstraints).toEqual({
      dietary: ["kosher"],
      allergies: ["peanuts"],
      unavailable: [],
    });
  });
});

/**
 * ---------------------------------------------------------------------------
 * participantMeetingContextFromRow
 * ---------------------------------------------------------------------------
 */

function participantMeetingContextRow(
  overrides: Partial<ParticipantMeetingContextModel> = {}
): ParticipantMeetingContextModel {
  return {
    id: "pmc1",
    meetingId: "m1",
    userId: "u1",
    originLat: null,
    originLng: null,
    originLabel: null,
    mobilityWindows: [],
    softPreferences: null,
    rejectionText: null,
    rejectionOutcome: null,
    note: null,
    createdAt: new Date("2026-08-27T09:00:00.000Z"),
    ...overrides,
  } satisfies ParticipantMeetingContextModel;
}

describe("participantMeetingContextFromRow", () => {
  it("composes the two origin columns into one LatLng", () => {
    const context = participantMeetingContextFromRow(
      participantMeetingContextRow({ originLat: 32.08, originLng: 34.78 })
    );

    expect(context.origin).toEqual({ lat: 32.08, lng: 34.78 });
  });

  it("treats an unset origin as null, not as (0, 0)", () => {
    expect(
      participantMeetingContextFromRow(participantMeetingContextRow()).origin
    ).toBeNull();
  });

  it("carries the rest of the row through unchanged", () => {
    const mobilityWindows = [
      {
        mode: "car",
        available: false,
        window: { weekdays: [], from: "18:00", to: "21:00" },
      },
    ];
    const context = participantMeetingContextFromRow(
      participantMeetingContextRow({
        originLabel: "Coming from work",
        mobilityWindows,
        note: "No car tonight.",
      })
    );

    expect(context.originLabel).toBe("Coming from work");
    expect(context.mobilityWindows).toEqual(mobilityWindows);
    expect(context.note).toBe("No car tonight.");
  });

  // A7 writes a correction here; an amendment leaves the column NULL. The two
  // must not collapse into one value: "no correction" is not "corrected to
  // nothing" (issue #86).
  it("reads a correction back, and leaves an amendment's absence as null", () => {
    expect(
      participantMeetingContextFromRow(
        participantMeetingContextRow({
          softPreferences: { noiseLevel: "quiet" },
        })
      ).softPreferences
    ).toEqual({ noiseLevel: "quiet" });

    expect(
      participantMeetingContextFromRow(participantMeetingContextRow())
        .softPreferences
    ).toBeNull();
  });
});

/**
 * A8's field-wise read. The scenario each case is drawn from is one evening:
 * Dana amends at 19:00 ("coming from work"), then rejects at 20:30 ("too
 * loud"). Two rows, two different halves filled in, and a run that reads the
 * newest one gets exactly half of what she said.
 */
describe("mergeContexts", () => {
  const CAR_UNAVAILABLE = [
    {
      mode: "car",
      available: false,
      window: { weekdays: [], from: "18:00", to: "21:00" },
    },
  ];

  const amendment = participantMeetingContextFromRow(
    participantMeetingContextRow({
      id: "amendment",
      originLat: 32.07,
      originLng: 34.79,
      originLabel: "Coming from work",
      mobilityWindows: CAR_UNAVAILABLE,
      createdAt: new Date("2026-09-24T16:00:00.000Z"),
    })
  );

  const correction = participantMeetingContextFromRow(
    participantMeetingContextRow({
      id: "correction",
      softPreferences: { noiseLevel: "quiet" },
      createdAt: new Date("2026-09-24T17:30:00.000Z"),
    })
  );

  it("keeps both halves when a correction follows an amendment", () => {
    const merged = mergeContexts([amendment, correction]);

    expect(merged?.softPreferences).toEqual({ noiseLevel: "quiet" });
    expect(merged?.origin).toEqual({ lat: 32.07, lng: 34.79 });
    expect(merged?.mobilityWindows).toEqual(CAR_UNAVAILABLE);
  });

  it("keeps both halves in the other order too", () => {
    const merged = mergeContexts([correction, amendment]);

    expect(merged?.softPreferences).toEqual({ noiseLevel: "quiet" });
    expect(merged?.origin).toEqual({ lat: 32.07, lng: 34.79 });
  });

  it("takes the newest row that has the field", () => {
    const later = participantMeetingContextFromRow(
      participantMeetingContextRow({
        originLat: 31.77,
        originLng: 35.21,
        originLabel: "Actually from home",
        createdAt: new Date("2026-09-24T18:00:00.000Z"),
      })
    );

    expect(mergeContexts([amendment, correction, later])?.origin).toEqual({
      lat: 31.77,
      lng: 35.21,
    });
  });

  // "Too loud" at 20:30 and "too expensive" at 21:15 are two complaints about
  // two different things, and both are still true. Replacing the object
  // wholesale would answer the second and forget the first.
  it("keeps two corrections that land on different fields", () => {
    const second = participantMeetingContextFromRow(
      participantMeetingContextRow({
        softPreferences: { budget: "modest" },
        createdAt: new Date("2026-09-24T18:00:00.000Z"),
      })
    );

    expect(mergeContexts([correction, second])?.softPreferences).toEqual({
      noiseLevel: "quiet",
      budget: "modest",
    });
  });

  // Merging across fields is not accumulating within one: saying "quiet"
  // after "lively" is a change of mind, and the newer value wins outright.
  it("lets the newest correction win on a field it repeats", () => {
    const lively = participantMeetingContextFromRow(
      participantMeetingContextRow({
        softPreferences: { noiseLevel: "lively" },
        createdAt: new Date("2026-09-24T15:00:00.000Z"),
      })
    );

    expect(mergeContexts([lively, correction])?.softPreferences).toEqual({
      noiseLevel: "quiet",
    });
  });

  // A label describing coordinates from a different row would be a sentence
  // about a place nobody is starting from.
  it("takes origin and its label from one row, never two", () => {
    const labelOnly = participantMeetingContextFromRow(
      participantMeetingContextRow({
        originLabel: "From the office",
        createdAt: new Date("2026-09-24T18:00:00.000Z"),
      })
    );
    const merged = mergeContexts([amendment, labelOnly]);

    expect(merged?.originLabel).toBe("From the office");
    expect(merged?.origin).toBeNull();
  });

  it("does not let an empty mobility list erase an earlier one", () => {
    expect(mergeContexts([amendment, correction])?.mobilityWindows).toEqual(
      CAR_UNAVAILABLE
    );
  });

  it("is null when the person has no rows at all", () => {
    expect(mergeContexts([])).toBeNull();
  });
});

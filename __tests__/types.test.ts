import { describe, expect, it } from "vitest";

import type {
  MeetingStatus as PrismaMeetingStatus,
  ResponseStatus as PrismaResponseStatus,
} from "@/lib/generated/prisma/enums";
import type { MeetingModel } from "@/lib/generated/prisma/models";
import {
  meetingFromRow,
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

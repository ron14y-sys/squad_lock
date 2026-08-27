/**
 * The one worked converter, from a database row to the shape the app speaks.
 *
 * There are eight tables and only one converter here on purpose. This is the
 * example — Track B writes the others as it needs them, following this shape.
 * `Meeting` is the one worth doing first because it is the one with a real
 * seam to hide: the database holds the pinned date and the pinned time in two
 * columns, and nothing outside this file should know that.
 *
 * The generated row type is `MeetingModel`, not `Meeting` — the two names do
 * not collide, so both can be imported into the same file without aliasing.
 */

import type { MeetingModel } from "@/lib/generated/prisma/models";

import type { Meeting, PinnedWhen } from "./meeting";
import type { LocalDate } from "./primitives";

/**
 * A `@db.Date` column arrives as a `Date` at UTC midnight — Prisma stores a
 * date with no time that way. So the UTC getters are the correct ones here,
 * and the local ones would shift the day backwards for anyone east of
 * Greenwich, which is everyone using this app.
 */
function toLocalDate(date: Date): LocalDate {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function toPinnedWhen(
  pinnedDate: Date | null,
  pinnedTime: string | null
): PinnedWhen | null {
  // A time with no date says nothing schedulable, so it is not a pin.
  if (pinnedDate === null) return null;

  const date = toLocalDate(pinnedDate);

  // A day with no time yet. Deliberately not midnight — that would be a time
  // the initiator never chose, and every downstream stage would believe it.
  if (pinnedTime === null) return { kind: "date", date };

  return { kind: "date_and_time", date, time: pinnedTime };
}

export function meetingFromRow(row: MeetingModel): Meeting {
  return {
    id: row.id,
    groupId: row.groupId,
    initiatorId: row.initiatorId,
    status: row.status,
    cycleCount: row.cycleCount,
    pinnedWhen: toPinnedWhen(row.pinnedDate, row.pinnedTime),
    pinnedVenue: row.pinnedVenue,
    occasion: row.occasion,
    currentDatetime: row.currentDatetime,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

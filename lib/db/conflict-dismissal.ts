// Cross-group conflict query (B5b, spec §5.7). Several meetings run in
// parallel and a user belongs to several groups, so two proposals can land
// on the same evening in two different groups — this is a user-level query
// over every open meeting the user has, in every group, not a group-level
// one.
//
// A pure query plus a pure overlap function, no LLM. The cancellation this
// feeds into (approving one conflicting meeting cancels the other, in one
// transaction) is B5c's job; the UI — the warning strip and its two escape
// hatches — is C6's.

import { APP_TIME_ZONE } from "@/lib/types/primitives";
import { meetingFromRow } from "@/lib/types/meeting-from-row";

import { OPEN_MEETING_STATUSES } from "./meetings";
import { getPrisma } from "./client";

import type { MeetingModel } from "@/lib/generated/prisma/models";
import type { Meeting } from "@/lib/types/meeting";

/** spec §5.7: "on the same calendar day, less than 4 hours apart." Tunable. */
const CONFLICT_WINDOW_MS = 4 * 60 * 60 * 1000;

/** Built once. `Intl.DateTimeFormat` is expensive to construct, cheap to reuse. */
const LOCAL_DATE_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * The calendar day an instant falls on in `APP_TIME_ZONE` — same edge, same
 * reasoning, and the same `Intl.formatToParts` approach as
 * `lib/matching/constraints.ts`'s `weekMinuteOf` (see the time rule in
 * `lib/types/primitives.ts`).
 */
function localCalendarDay(instant: Date): string {
  const parts = LOCAL_DATE_PARTS.formatToParts(instant);
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${value("year")}-${value("month")}-${value("day")}`;
}

/**
 * Pure overlap function (spec §5.7). A meeting has a start but no duration,
 * so literal interval overlap is not computable — this is the closest
 * substitute the spec defines: same calendar day, less than 4 hours apart.
 * The cost of a false positive (an unwanted cancellation) is higher than a
 * false negative here, which is why this stays a fixed, legible rule rather
 * than something fuzzier.
 */
export function meetingsConflict(a: Date, b: Date): boolean {
  if (localCalendarDay(a) !== localCalendarDay(b)) return false;
  return Math.abs(a.getTime() - b.getTime()) < CONFLICT_WINDOW_MS;
}

/**
 * `ConflictDismissal`'s unique constraint is ordered (see that model's own
 * comment in prisma/schema.prisma) — this is the one place, for both the
 * lookup below and any future insert, that puts a pair of meeting ids into
 * that canonical order.
 */
export function canonicalMeetingPair(
  meetingId1: string,
  meetingId2: string
): [string, string] {
  return meetingId1 < meetingId2
    ? [meetingId1, meetingId2]
    : [meetingId2, meetingId1];
}

/** Non-null by the `currentDatetime: { not: null }` filter in the query below. */
function requireCurrentDatetime(row: MeetingModel): Date {
  if (row.currentDatetime === null) {
    throw new Error(
      `Meeting ${row.id} has no currentDatetime — the query that fetched it should have excluded this row.`
    );
  }
  return row.currentDatetime;
}

export type ConflictingMeetingPair = {
  meetingA: Meeting;
  meetingB: Meeting;
};

/**
 * Every pair of this user's own open meetings, across every group, that
 * conflict by `meetingsConflict` — with any pair the user has already
 * dismissed left out.
 *
 * A meeting with no `currentDatetime` yet (nothing proposed, so nothing to
 * conflict on) is excluded at the query itself, not filtered afterwards.
 */
export async function findConflictingMeetings(
  userId: string
): Promise<ConflictingMeetingPair[]> {
  const prisma = getPrisma();

  const responses = await prisma.response.findMany({
    where: {
      userId,
      meeting: {
        status: { in: OPEN_MEETING_STATUSES },
        currentDatetime: { not: null },
      },
    },
    include: { meeting: true },
  });
  const meetingRows = responses.map((response) => response.meeting);
  if (meetingRows.length < 2) return [];

  const dismissals = await prisma.conflictDismissal.findMany({
    where: { userId },
    select: { meetingAId: true, meetingBId: true },
  });
  const dismissedPairs = new Set(
    dismissals.map(
      ({ meetingAId, meetingBId }) => `${meetingAId}:${meetingBId}`
    )
  );

  const conflicts: ConflictingMeetingPair[] = [];
  for (let i = 0; i < meetingRows.length; i++) {
    for (let j = i + 1; j < meetingRows.length; j++) {
      const rowA = meetingRows[i];
      const rowB = meetingRows[j];

      if (
        !meetingsConflict(
          requireCurrentDatetime(rowA),
          requireCurrentDatetime(rowB)
        )
      ) {
        continue;
      }

      const [dismissedA, dismissedB] = canonicalMeetingPair(rowA.id, rowB.id);
      if (dismissedPairs.has(`${dismissedA}:${dismissedB}`)) continue;

      conflicts.push({
        meetingA: meetingFromRow(rowA),
        meetingB: meetingFromRow(rowB),
      });
    }
  }

  return conflicts;
}

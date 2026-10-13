// #251: "one of these needs to change" moves the meeting to another time —
// or another day — at the venue it already has, at once, instead of sending
// it back for a full weighing. The venue and the reasons it suits each
// person still stand; only the evening clashed. No search, no model: the
// group's shared windows, the venue's hours and every hard constraint, on
// the same terms a full weighing uses (`participantsAndSlots`,
// `buildShortlist`). Only when the venue has no other evening for this group
// is the meeting weighed in full, and then straight away.

import { getPrisma } from "@/lib/db/client";
import { persistMatchRun } from "@/lib/db/match-run";
import { resetResponsesForNewProposal } from "@/lib/db/meetings";
import { fetchPlaceDetailsCached } from "@/lib/db/places-cache";
import { fetchBusyForUsers } from "@/lib/calendar/participant-busy";
import { notifyProposalWaiting } from "@/lib/email/notify";
import { MeetingStatus } from "@/lib/generated/prisma/enums";
import type { Candidate, ParticipantMeetingContext } from "@/lib/types";
import { parseVenuePrice } from "@/lib/places/price";
import { participantMeetingContextFromRow } from "@/lib/types/participant-meeting-context-from-row";
import type { MatchRunDraft } from "./agent";
import { buildShortlist } from "./funnel";
import {
  blockedByRejections,
  NoSolutionError,
  participantsAndSlots,
  runCycle,
  searchWindow,
  TIME_OF_DAY_HOURS,
  venueDietaryFactsFrom,
  type BusyLookup,
  type RecordedRejection,
} from "./run-cycle";
import { pairId } from "./schemas";
import type { TimeOfDayPart } from "@/lib/types";

/**
 * - `rescheduled` — a new time at the same venue, written as a run of its own.
 * - `unchanged` — the best time is the one it had (whoever clashed has
 *   dropped out of it), so the proposal stands.
 * - `reweighed` — the venue has no other evening for this group; weighed in
 *   full, now.
 * - `skipped` — not a meeting this applies to: closed, cancelled, stuck, or
 *   already about to be weighed for what somebody said.
 */
export type RescheduleOutcome =
  "rescheduled" | "unchanged" | "reweighed" | "skipped";

export async function rescheduleForConflict(
  meetingId: string,
  now: Date = new Date(),
  busyFor: BusyLookup = fetchBusyForUsers
): Promise<RescheduleOutcome> {
  const prisma = getPrisma();

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: {
      responses: {
        include: { user: { include: { preferenceProfile: true } } },
      },
      participantContexts: {
        orderBy: { createdAt: "asc" },
        include: { seenByRuns: { select: { matchRunId: true } } },
      },
      matchRuns: {
        orderBy: { cycleNumber: "asc" },
        include: { options: { where: { rank: 1 } } },
      },
    },
  });
  if (!meeting) return "skipped";
  if (
    meeting.status !== MeetingStatus.awaiting &&
    meeting.status !== MeetingStatus.weighing
  ) {
    return "skipped";
  }
  // Something somebody said is waiting to be answered: the weighing it is
  // owed will avoid the clash on its own (other meetings are busy time).
  if (meeting.participantContexts.some((row) => row.seenByRuns.length === 0)) {
    return "skipped";
  }

  const lastRun = meeting.matchRuns[meeting.matchRuns.length - 1];
  const top = lastRun?.options[0];
  if (!lastRun || !top || !top.venuePlaceId) {
    return reweigh(meetingId, now, busyFor);
  }

  const attending = meeting.responses.filter(
    (response) => response.status !== "cant_make_it"
  );
  if (attending.length === 0) return reweigh(meetingId, now, busyFor);

  const contextRows = new Map<string, ParticipantMeetingContext[]>();
  const recorded: RecordedRejection[] = [];
  for (const row of meeting.participantContexts) {
    const rows = contextRows.get(row.userId) ?? [];
    rows.push(participantMeetingContextFromRow(row));
    contextRows.set(row.userId, rows);
    if (row.rejectionText !== null) {
      recorded.push({ at: row.createdAt, outcome: row.rejectionOutcome });
    }
  }
  const blocked = blockedByRejections(
    meeting.matchRuns.flatMap((run) =>
      run.options.map((option) => ({
        at: run.createdAt,
        placeId: option.venuePlaceId,
        slot: { start: option.proposedDatetime, end: option.proposedEnd },
      }))
    ),
    recorded
  );

  const part: TimeOfDayPart | null =
    meeting.pinnedTime && meeting.pinnedTime in TIME_OF_DAY_HOURS
      ? (meeting.pinnedTime as TimeOfDayPart)
      : null;

  // Any day in the usual horizon, not only a pinned one: the day itself may
  // be what clashed. The part of day still holds.
  let availability;
  try {
    availability = await participantsAndSlots(
      meetingId,
      attending,
      contextRows,
      searchWindow(null, now),
      part,
      busyFor
    );
  } catch (error) {
    if (error instanceof NoSolutionError) {
      return reweigh(meetingId, now, busyFor);
    }
    throw error;
  }
  const { participants, slots, unread } = availability;

  const details = await fetchPlaceDetailsCached(top.venuePlaceId);
  const venue: Candidate = {
    placeId: top.venuePlaceId,
    name: top.venueName,
    address: top.venueAddress,
    location: { lat: top.venueLat ?? 0, lng: top.venueLng ?? 0 },
    neighbourhood: null,
    rating: details.rating,
    openingHours: details.openingHours,
    typeLabel: top.venueType ?? undefined,
    summary: top.venueSummary ?? undefined,
    // The snapshot's own price, like its summary: an option made before #249
    // has none, and the venue is the same one.
    price: parseVenuePrice(top.venuePrice),
  };
  const venueFacts = venueDietaryFactsFrom([
    {
      placeId: venue.placeId,
      servesVegetarianFood: details.servesVegetarianFood,
    },
  ]);
  const weighed = buildShortlist({
    candidates: [venue],
    participants,
    slots,
    venueFacts,
  });
  const viable = weighed.viable.filter(
    (pair) => !blocked.pairs.has(pairId(pair.candidatePlaceId, pair.slot))
  );
  if (viable.length === 0) return reweigh(meetingId, now, busyFor);

  // The smallest change: the evening nearest the one that clashed.
  const was = top.proposedDatetime.getTime();
  const [best] = [...viable].sort(
    (a, b) =>
      Math.abs(a.slot.start.getTime() - was) -
      Math.abs(b.slot.start.getTime() - was)
  );

  if (
    best.slot.start.getTime() === was &&
    best.slot.end.getTime() === top.proposedEnd.getTime()
  ) {
    await prisma.meeting.update({
      where: { id: meetingId },
      data: {
        status: MeetingStatus.awaiting,
        currentDatetime: top.proposedDatetime,
      },
    });
    return "unchanged";
  }

  const draft: MatchRunDraft = {
    meetingId,
    cycleNumber: lastRun.cycleNumber + 1,
    shortlist: weighed.shortlist,
    options: [
      {
        rank: 1,
        venue: {
          placeId: venue.placeId,
          name: venue.name,
          address: venue.address,
          location:
            top.venueLat !== null && top.venueLng !== null
              ? venue.location
              : null,
          typeLabel: venue.typeLabel,
          summary: venue.summary,
          price: venue.price,
        },
        proposedDatetime: best.slot.start,
        proposedEnd: best.slot.end,
        // The venue and the trip have not changed, so neither have the
        // reasons it suits each person.
        participantJustifications: top.participantJustifications,
        tradeoffs: top.tradeoffs,
        unverified: [
          ...best.unverified,
          ...unread.map((userId) => ({ kind: "calendar" as const, userId })),
        ],
      },
    ],
  } as MatchRunDraft;

  const seen = meeting.participantContexts
    .filter((row) => row.seenByRuns.some((s) => s.matchRunId === lastRun.id))
    .map((row) => row.id);

  await prisma.$transaction(async (tx) => {
    // No `call`: no model was asked, and that is what marks this run as a
    // reschedule rather than a rematch (`weigh`'s `cycleCount`).
    const run = await persistMatchRun(draft, undefined, tx);
    // The same rows the last run had seen, so the timeline does not read
    // them as new reasons for the run after this one.
    if (seen.length > 0) {
      await tx.matchRunSeenContext.createMany({
        data: seen.map((contextId) => ({ matchRunId: run.id, contextId })),
      });
    }
    // Every approval was of the old time.
    await resetResponsesForNewProposal(tx, meetingId);
    await tx.meeting.update({
      where: { id: meetingId },
      data: {
        status: MeetingStatus.awaiting,
        currentDatetime: best.slot.start,
        runStage: null,
        retryNotBefore: null,
      },
    });
  });

  await notifyProposalWaiting(meetingId);
  return "rescheduled";
}

/** No other evening at this venue: a full weighing, now rather than on a timer. */
async function reweigh(
  meetingId: string,
  now: Date,
  busyFor: BusyLookup
): Promise<RescheduleOutcome> {
  await getPrisma().meeting.update({
    where: { id: meetingId },
    data: { status: MeetingStatus.weighing, currentDatetime: null },
  });
  await runCycle(meetingId, now, busyFor);
  return "reweighed";
}

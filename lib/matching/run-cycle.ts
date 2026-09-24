/**
 * A8 — one weighing cycle of one meeting, from rows to a proposal.
 *
 * Every stage this file calls already existed and was tested. What did not
 * exist was anything that put them in a row: `runMatchingAgent` had no caller
 * outside `evals/`, the demo script and its own tests, so no meeting had ever
 * received a proposal and `lib/db/meeting-detail.ts` returned `proposal: null`
 * for every row in the database.
 *
 * ## Why this is two functions
 *
 * `assembleRun` decides; `runCycle` (step 4) executes. Every mistake this
 * task can make is in the first — which origin won, which field came from
 * which row, who is even participating, which venues were dropped and why —
 * and the first returns one object you can print, so all of that can be
 * looked at without spending a Gemini call. The same split, for the same
 * reason, as `toMatchRunCreate` / `persistMatchRun` in
 * [`lib/db/match-run.ts`](../db/match-run.ts).
 *
 * ## The one thing that is not a straight line
 *
 * Opening hours are an Enterprise-tier Places field, fetched only for the
 * shortlist (spec §6.3) — but choosing a shortlist is what needs them. The
 * header of [`funnel.ts`](./funnel.ts) names the circle and leaves it open.
 *
 * It is answered here by running the funnel **twice**: once over everything
 * the search returned, to find the two dozen worth paying for, and again over
 * exactly those two dozen once their real hours are attached. The second pass
 * is pure and costs nothing, and it can shrink or drop a candidate the first
 * one accepted — which is the point. No new filtering logic: the same
 * function, given better facts.
 */

import {
  APP_TIME_ZONE,
  type Candidate,
  type Participant,
  type ParticipantMeetingContext,
  type TimeSlot,
} from "@/lib/types";
import {
  mergeContexts,
  participantMeetingContextFromRow,
} from "@/lib/types/participant-meeting-context-from-row";
import { preferenceProfileFromRow } from "@/lib/types/preference-profile-from-row";
import { fetchBusyForUsers } from "@/lib/calendar/participant-busy";
import { getPrisma } from "@/lib/db/client";
import {
  fetchPlaceDetailsCached,
  searchNeighbourhoodCached,
} from "@/lib/db/places-cache";
import {
  deriveSearchCentres,
  SEARCH_RADIUS_METERS,
} from "@/lib/places/search-area";
import { commonFreeWindows } from "./availability";
import { originOf } from "./distance";
import { pairId } from "./schemas";
import type { ExtractionOutcome } from "@/lib/generated/prisma/enums";
import { buildShortlist } from "./funnel";
import type { MatchAgentInput } from "./agent";

/**
 * How far ahead to look when the initiator pinned no date.
 *
 * Nothing in the spec fixes this, so it is a constant rather than a decision
 * dressed up as one. Longer means more evenings to choose between and a
 * bigger payload; shorter means a group with busy calendars finds nothing.
 */
export const SEARCH_HORIZON_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Built once — `Intl.DateTimeFormat` is expensive to construct, cheap to reuse. */
const ZONE_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/**
 * How far ahead of UTC `APP_TIME_ZONE` is at `instant`, in milliseconds.
 *
 * DST-correct, because `Intl` owns the offset and we never write one down —
 * the same `formatToParts` approach as `weekMinuteOf` in
 * [`constraints.ts`](./constraints.ts) and `localCalendarDay` in
 * [`conflict-dismissal.ts`](../db/conflict-dismissal.ts). Reading the wall
 * clock back as though it were UTC and subtracting is the whole trick.
 */
function zoneOffsetMs(instant: Date): number {
  const parts = ZONE_PARTS.formatToParts(instant);
  const value = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  const asIfUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second")
  );
  // Seconds, not milliseconds: `formatToParts` has no sub-second field, so
  // the instant is truncated to match rather than the offset inheriting its
  // milliseconds.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The stretch of time a run is allowed to propose from.
 *
 * With a pinned date, that day and only that day — B5 left `pinnedDate`
 * unread and said in as many words that the `APP_TIME_ZONE` conversion
 * belongs to whoever reads it first (`initiateMeeting`'s own comment). The
 * column is a `@db.Date`, so Prisma hands back midnight **UTC** on that
 * calendar day; the local day starts two or three hours before that instant,
 * which is exactly what `zoneOffsetMs` is for.
 *
 * Without one, `SEARCH_HORIZON_DAYS` from now.
 *
 * Clamped to `now` either way: a pinned day that is half over is still
 * proposable for the evening, and one that is entirely over leaves an empty
 * window, which `commonFreeWindows` refuses — a "no solution", not a fault.
 *
 * `pinnedTime` and `pinnedVenue` are still unread. They narrow rather than
 * select, and the narrowing belongs with them as one piece of work.
 */
export function searchWindow(pinnedDate: Date | null, now: Date): TimeSlot {
  if (!pinnedDate) {
    return {
      start: now,
      end: new Date(now.getTime() + SEARCH_HORIZON_DAYS * DAY_MS),
    };
  }

  const midnightUtc = pinnedDate.getTime();
  const localMidnight = midnightUtc - zoneOffsetMs(new Date(midnightUtc));

  return {
    start: new Date(Math.max(localMidnight, now.getTime())),
    // A day that crosses a DST change is 23 or 25 hours, not 24. The hour
    // that moves is 02:00, and a venue is not open then, so the error cannot
    // reach a proposal.
    end: new Date(localMidnight + DAY_MS),
  };
}

/* -------------------------------------------------------------------------
 * A8b — what a rejection takes off the table
 * ---------------------------------------------------------------------- */

/** Rank 1 of one earlier run: what the group was actually offered, and when. */
export type PriorProposal = {
  at: Date;
  placeId: string | null;
  slot: TimeSlot;
};

/** One rejection as it was recorded, with what A7 made of it at the time. */
export type RecordedRejection = {
  at: Date;
  outcome: ExtractionOutcome | null;
};

export type Blocked = {
  /** Venues that may not be offered again at any hour. */
  venues: Set<string>;
  /** Exact `(venue, slot)` pairs, by `pairId`. */
  pairs: Set<string>;
};

/**
 * What this meeting's history forbids the next proposal from containing
 * ([#17](https://github.com/ron14y-sys/squad_lock/issues/17)).
 *
 * Two rules, and the second is the one that needed the new column.
 *
 * **No proposal is ever repeated.** Every earlier run's rank-1 pair is
 * blocked. #17 asks for this about the option just rejected; doing it for all
 * of them costs nothing and closes the case where an option comes back two
 * cycles later as though nobody had said anything.
 *
 * **A venue goes entirely when the objection was about the venue**, and only
 * the pair goes when it was about the hour:
 *
 * | Outcome | Blocked | Why |
 * | ------- | ------- | --- |
 * | `venue_identity` | the venue | "not that place" |
 * | `soft` | the venue | too loud, too expensive — a property of the place, and 19:00 does not fix it |
 * | `time` | the pair | the same venue three hours earlier is the right answer, not a worse one |
 * | `distance` | the pair | reach genuinely varies by hour — "no car after 21:00" ([#89](https://github.com/ron14y-sys/squad_lock/issues/89)) |
 * | `none`, `failed_*` | the pair | nothing was understood, so block the minimum #17 requires and let the sentence do the rest |
 *
 * Which venue a rejection was *about* is the one that was on screen when it
 * was written — the latest proposal at or before it. That is why the outcome
 * is recorded per row rather than read off `Response.extractionOutcome`,
 * which only ever holds the last one.
 *
 * Pure: no database, no clock.
 */
export function blockedByRejections(
  proposals: readonly PriorProposal[],
  rejections: readonly RecordedRejection[]
): Blocked {
  const venues = new Set<string>();
  const pairs = new Set<string>();

  for (const proposal of proposals) {
    if (proposal.placeId) {
      pairs.add(pairId(proposal.placeId, proposal.slot));
    }
  }

  for (const rejection of rejections) {
    if (
      rejection.outcome !== "soft" &&
      rejection.outcome !== "venue_identity"
    ) {
      continue;
    }

    let rejected: PriorProposal | undefined;
    for (const proposal of proposals) {
      if (proposal.at.getTime() <= rejection.at.getTime()) rejected = proposal;
    }
    if (rejected?.placeId) venues.add(rejected.placeId);
  }

  return { venues, pairs };
}

/**
 * Everything one run needs, read out of the database and put in the shape A4
 * takes. Throws rather than returning a partial answer: a run assembled from
 * half the group is a worse outcome than no run.
 *
 * Returns the input and nothing else. The ids of every context row it read
 * (for `MatchRunSeenContext`) and the pairs it dropped (for the `stuck`
 * reason) both have callers coming in steps 4 and 5, and gain their place in
 * the return type there rather than sitting unused here.
 */
export async function assembleRun(
  meetingId: string,
  now: Date = new Date()
): Promise<MatchAgentInput> {
  const prisma = getPrisma();

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: {
      responses: {
        include: { user: { include: { preferenceProfile: true } } },
      },
      // Oldest first, which is the order `mergeContexts` reads.
      participantContexts: { orderBy: { createdAt: "asc" } },
      // Rank 1 of every earlier cycle — what this group has already been
      // offered, and therefore what may not be offered again.
      matchRuns: {
        orderBy: { cycleNumber: "asc" },
        include: { options: { where: { rank: 1 } } },
      },
    },
  });
  if (!meeting) throw new Error(`a8: no meeting ${meetingId}`);

  // Everybody who has not dropped out. Somebody who has not answered yet is
  // still being proposed to — `pending` is the state most of the group is in
  // when a run happens, not an absence.
  const attending = meeting.responses.filter(
    (response) => response.status !== "cant_make_it"
  );
  if (attending.length === 0) {
    throw new Error(`a8: nobody is still coming to ${meetingId}`);
  }

  const contextRows = new Map<string, ParticipantMeetingContext[]>();
  // Everything each person has said when rejecting, oldest first. The
  // vocabulary cannot hold every objection — "no Asian food" lands in no
  // field — so for those the sentence is the whole memory, and A4 is given
  // all of them rather than the latest (agent.ts, `rejections`).
  const rejections: Record<string, string[]> = {};
  const recorded: RecordedRejection[] = [];

  for (const row of meeting.participantContexts) {
    const rows = contextRows.get(row.userId) ?? [];
    rows.push(participantMeetingContextFromRow(row));
    contextRows.set(row.userId, rows);

    if (row.rejectionText !== null) {
      (rejections[row.userId] ??= []).push(row.rejectionText);
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

  const window = searchWindow(meeting.pinnedDate, now);
  const busyByUser = await fetchBusyForUsers(
    attending.map((response) => response.userId),
    window
  );

  const participants: Participant[] = attending.map((response) => {
    const profileRow = response.user.preferenceProfile;
    if (!profileRow) {
      throw new Error(`a8: ${response.userId} has no preference profile`);
    }

    const profile = preferenceProfileFromRow(profileRow);
    const context = mergeContexts(contextRows.get(response.userId) ?? []);

    return {
      userId: response.userId,
      name: response.user.name,
      profile,
      context,
      // Spec §5.7's precedence, and the only place it is applied: tonight's
      // amendment outranks home. The recurring rules sit between the two and
      // are A12's to resolve; until then home is the fallback.
      origin: context?.origin ?? profile.home,
      busy: busyByUser.get(response.userId) ?? [],
    };
  });

  const slots = commonFreeWindows(participants, window);
  if (slots.length === 0) {
    throw new Error(`a8: no window ${meetingId}'s group shares`);
  }

  // `originOf` throws for anyone with no home location, and that is its own
  // deliberate decision — leximin compares vectors position by position, so
  // quietly dropping whoever has not finished onboarding would make them the
  // one person the fairness rule never protects. Resolving every origin
  // *here*, before the search, only changes when that error arrives: a run
  // that cannot finish should not first spend Enterprise-tier Places calls.
  const origins = participants.map(originOf);

  const pools = await Promise.all(
    deriveSearchCentres(origins).map((centre) =>
      searchNeighbourhoodCached(centre, SEARCH_RADIUS_METERS)
    )
  );
  // `buildShortlist` dedupes, so the pools are merged and not reconciled.
  // Blocked venues come out here rather than at the end: a venue that may
  // not be proposed should not first cost an Enterprise-tier details call.
  const found = pools
    .flat()
    .filter((candidate) => !blocked.venues.has(candidate.placeId));
  if (found.length === 0) {
    throw new Error(`a8: no venue was found near ${meetingId}'s group`);
  }

  // First pass — no hours anywhere, so every candidate looks open all window.
  // Its only job is to choose whose Enterprise-tier details are worth buying.
  const provisional = buildShortlist({
    candidates: found,
    participants,
    slots,
  });

  const priced: Candidate[] = await Promise.all(
    provisional.shortlist.map(async (score) => ({
      ...score.candidate,
      ...(await fetchPlaceDetailsCached(score.candidate.placeId)),
    }))
  );

  // Second pass — the same funnel over the same two dozen, now knowing when
  // each one is actually open. This is where an evening gets shortened to fit
  // a venue, and where one that is shut tonight finally falls out.
  const shortlisted = buildShortlist({
    candidates: priced,
    participants,
    slots,
  });
  // An identical proposal is never repeated, so the exact pairs go last —
  // they can only be recognised once the funnel has cut the evenings.
  const viable = shortlisted.viable.filter(
    (pair) => !blocked.pairs.has(pairId(pair.candidatePlaceId, pair.slot))
  );
  const offerable = new Set(viable.map((pair) => pair.candidatePlaceId));
  // A venue whose every hour was blocked stays out of the payload entirely.
  // A4 could not pick it — it re-checks against `viable` — but listing a
  // candidate the agent may not choose is an invitation to try.
  const ranked = shortlisted.shortlist.filter((score) =>
    offerable.has(score.candidate.placeId)
  );

  if (ranked.length === 0) {
    throw new Error(
      `a8: nothing survived the filter for ${meetingId} — ${shortlisted.droppedPairs.length} pairs dropped, ${shortlisted.gatedOut.length} gated out, ${blocked.venues.size} venues and ${blocked.pairs.size} pairs already rejected`
    );
  }

  return {
    meetingId,
    cycleNumber: meeting.cycleCount + 1,
    occasion: meeting.occasion,
    participants,
    candidates: ranked.map((score) => score.candidate),
    viable,
    ranked,
    rejections,
    // `venueFacts` and `venueSoftFacts` stay absent rather than empty: B7
    // fetches neither dietary tags nor atmosphere, and an empty object would
    // tell A2 and A4 that nothing is true of these venues rather than that
    // nothing is known (the rule `findRejectedOption` already follows).
  };
}

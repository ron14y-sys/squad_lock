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
  for (const row of meeting.participantContexts) {
    const rows = contextRows.get(row.userId) ?? [];
    rows.push(participantMeetingContextFromRow(row));
    contextRows.set(row.userId, rows);
  }

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
  const found = pools.flat();
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
  if (shortlisted.shortlist.length === 0) {
    throw new Error(
      `a8: nothing survived the filter for ${meetingId} — ${shortlisted.droppedPairs.length} pairs dropped, ${shortlisted.gatedOut.length} gated out`
    );
  }

  return {
    meetingId,
    cycleNumber: meeting.cycleCount + 1,
    occasion: meeting.occasion,
    participants,
    candidates: shortlisted.shortlist.map((score) => score.candidate),
    viable: shortlisted.viable,
    ranked: shortlisted.shortlist,
    // `venueFacts` and `venueSoftFacts` stay absent rather than empty: B7
    // fetches neither dietary tags nor atmosphere, and an empty object would
    // tell A2 and A4 that nothing is true of these venues rather than that
    // nothing is known (the rule `findRejectedOption` already follows).
  };
}

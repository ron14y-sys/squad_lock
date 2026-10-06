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
  type TimeOfDayPart,
  type TimeSlot,
  type VenueSoftFacts,
} from "@/lib/types";
import {
  mergeContexts,
  participantMeetingContextFromRow,
} from "@/lib/types/participant-meeting-context-from-row";
import { preferenceProfileFromRow } from "@/lib/types/preference-profile-from-row";
import { fetchBusyForUsers } from "@/lib/calendar/participant-busy";
import { CalendarAuthError } from "@/lib/calendar/freebusy";
import { getPrisma } from "@/lib/db/client";
import {
  fetchPlaceDetailsCached,
  searchNeighbourhoodCached,
} from "@/lib/db/places-cache";
import {
  deriveSearchCentres,
  SEARCH_RADIUS_METERS,
} from "@/lib/places/search-area";
import { persistMatchRun } from "@/lib/db/match-run";
import { resetResponsesForNewProposal } from "@/lib/db/meetings";
import { MeetingStatus, type RunStage } from "@/lib/generated/prisma/enums";
import { commonFreeWindows } from "./availability";
import { runMatchingAgent } from "./agent";
import { ExternalRateLimitError } from "@/lib/external/rate-limit";
import { LlmCallError, retryDelayMs } from "@/lib/llm/client";
import { originOf } from "./distance";
import { pairId } from "./schemas";
import type { ExtractionOutcome } from "@/lib/generated/prisma/enums";
import { buildShortlist } from "./funnel";
import {
  notifyCalendarReconnect,
  notifyProposalWaiting,
  notifyStuck,
} from "@/lib/email/notify";
import type { MatchAgentInput } from "./agent";

/**
 * The group cannot be given an evening, and that is the answer.
 *
 * Distinct from every other way a cycle can fail, because the two need
 * opposite handling: this one is written down as `stuck` — spec §3.1's "the
 * best option is shown with an explanation and the group decides manually",
 * and B6's rule that an empty intersection is `stuck` and not a bad proposal
 * — while a missing API key, an unconnected calendar or a model that timed
 * out leave the meeting in `weighing` for the next poll to retry.
 *
 * A meeting left in `weighing` after a real no-solution would be retried
 * forever, and one marked `stuck` after a fault would tell a group their
 * evening is impossible because somebody forgot an environment variable.
 *
 * Only three things raise it; everything else is a fault by default, so
 * there is no list of error types to keep up to date. The same shape as A7's
 * `failureOutcome`, which separates `failed_quota` from `failed_call` for
 * the same reason.
 */
export class NoSolutionError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "NoSolutionError";
  }
}

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
 * Without one, `SEARCH_HORIZON_DAYS` from now, **less a minute**. A full week
 * ends where it starts on `constraints.ts`'s weekly axis, which cannot place
 * it, and a group nobody in which is busy gets the whole window back from
 * `commonFreeWindows` as one slot — so every run failed, and a new group of
 * one with an empty calendar never got a proposal. Free time lies inside this
 * window, so keeping the window under a week keeps every slot under one.
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
      end: new Date(now.getTime() + SEARCH_HORIZON_DAYS * DAY_MS - 60_000),
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
 * #168: local hours for each part of day, agreed in #163. `endHour` is
 * exclusive, same convention as every other `TimeSlot` in this file.
 */
export const TIME_OF_DAY_HOURS: Record<
  TimeOfDayPart,
  { startHour: number; endHour: number }
> = {
  morning: { startHour: 8, endHour: 12 },
  midday: { startHour: 12, endHour: 17 },
  evening: { startHour: 18, endHour: 23 },
};

/**
 * #168, per the #165 follow-up comment on the issue: filtering *after* a
 * 20-result Nearby Search leaves almost nothing for a scarce kind (3 cafés
 * in central Tel Aviv on a real search) — so the chosen part sets
 * `includedTypes` in the search itself instead.
 */
export const TIME_OF_DAY_VENUE_KINDS: Record<TimeOfDayPart, string[]> = {
  morning: ["cafe"],
  midday: ["restaurant", "cafe"],
  evening: ["restaurant", "bar"],
};

/** The local midnight (as a UTC instant) of the calendar day `instant` falls on. */
function localMidnightOf(instant: Date): Date {
  const parts = ZONE_PARTS.formatToParts(instant);
  const value = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  const midnightAsIfUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day")
  );
  return new Date(midnightAsIfUtc - zoneOffsetMs(new Date(midnightAsIfUtc)));
}

/**
 * `outerWindow` narrowed to `part`'s local hours, one `TimeSlot` per calendar
 * day it spans — spec's own words in #168: "one window per day, not one long
 * window." A week-long horizon with no pinned date becomes up to
 * `SEARCH_HORIZON_DAYS` disjoint windows; a pinned day becomes at most one.
 * `commonFreeWindows` already returns several free slots from a single
 * window (busy blocks split it up) — this is the same idea one level up, so
 * nothing downstream of it needs to change.
 *
 * A day whose part-hours fall entirely outside `outerWindow` (already past,
 * or beyond the horizon) contributes no window rather than an empty one —
 * `commonFreeWindows` refuses a window that doesn't end after it starts.
 */
export function partOfDayWindows(
  outerWindow: TimeSlot,
  part: TimeOfDayPart
): TimeSlot[] {
  const { startHour, endHour } = TIME_OF_DAY_HOURS[part];
  const windows: TimeSlot[] = [];

  // +2 over the horizon: a pinned window is one day already, and rounding at
  // either end of a "no date" week can otherwise land one calendar day short.
  for (let day = 0; day <= SEARCH_HORIZON_DAYS + 2; day++) {
    const dayMidnight = localMidnightOf(
      new Date(outerWindow.start.getTime() + day * DAY_MS)
    );
    if (dayMidnight.getTime() >= outerWindow.end.getTime()) break;

    const start = new Date(
      Math.max(
        dayMidnight.getTime() + startHour * 60 * 60 * 1000,
        outerWindow.start.getTime()
      )
    );
    const end = new Date(
      Math.min(
        dayMidnight.getTime() + endHour * 60 * 60 * 1000,
        outerWindow.end.getTime()
      )
    );
    if (end.getTime() > start.getTime()) {
      windows.push({ start, end });
    }
  }

  return windows;
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
 * `contextIds` is every context row it read, which is exactly what
 * `MatchRunSeenContext` records — the join C6's timeline reads to say *why* a
 * re-weighing happened. The pairs it dropped still have no caller and so
 * still have no place here; step 5 gives them one.
 */
export type AssembledRun = {
  input: MatchAgentInput;
  contextIds: string[];
};

/**
 * Where busy blocks come from. Defaulted to B6's real one, and taken as an
 * argument for the same reason `persistMatchRun` takes its client: so
 * something without credentials can drive the whole path.
 *
 * It is the only seam here. Places needs none — seeding
 * `place_search_cache` and `place_details_cache` makes
 * `searchNeighbourhoodCached` and `fetchPlaceDetailsCached` return without
 * going out, which exercises the real code rather than bypassing it. A
 * calendar cannot be faked that way: `fetchBusyForUsers` raises for a
 * participant with no usable refresh token **on purpose** (B6 — treating an
 * unread calendar as "free" is the one mistake §5.7 names), so there is no
 * legitimate state in which it quietly returns nothing.
 */
export type BusyLookup = (
  userIds: string[],
  window: TimeSlot
) => Promise<Map<string, TimeSlot[]>>;

/** Told as a run enters each stage (#155). `runCycle` writes it to the meeting. */
export type StageReport = (stage: RunStage) => Promise<void>;

export async function assembleRun(
  meetingId: string,
  now: Date = new Date(),
  busyFor: BusyLookup = fetchBusyForUsers,
  reportStage: StageReport = async () => {}
): Promise<AssembledRun> {
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
    throw new NoSolutionError(`nobody is still coming to ${meetingId}`);
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

  // #168: a chosen part of day (stored in the same column an exact time used
  // to be) narrows both the search window and the venue kinds below.
  const part: TimeOfDayPart | null =
    meeting.pinnedTime && meeting.pinnedTime in TIME_OF_DAY_HOURS
      ? (meeting.pinnedTime as TimeOfDayPart)
      : null;

  const window = searchWindow(meeting.pinnedDate, now);
  await reportStage("calendars");
  const busyByUser = await busyFor(
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

  // `commonFreeWindows` already returns several free slots out of one
  // window (busy blocks split it up) — concatenating its output across
  // several *narrowed* windows needs no change downstream of this line.
  const slots = part
    ? partOfDayWindows(window, part).flatMap((dayWindow) =>
        commonFreeWindows(participants, dayWindow)
      )
    : commonFreeWindows(participants, window);
  if (slots.length === 0) {
    throw new NoSolutionError(
      `no window ${meetingId}'s group shares in the search period`
    );
  }

  // `originOf` throws for anyone with no home location, and that is its own
  // deliberate decision — leximin compares vectors position by position, so
  // quietly dropping whoever has not finished onboarding would make them the
  // one person the fairness rule never protects. Resolving every origin
  // *here*, before the search, only changes when that error arrives: a run
  // that cannot finish should not first spend Enterprise-tier Places calls.
  const origins = participants.map(originOf);

  await reportStage("places");
  // #168: the chosen part sets which kinds of venue the search itself asks
  // for — filtering afterwards left almost nothing for a scarce kind (see
  // TIME_OF_DAY_VENUE_KINDS's own comment). `undefined` keeps today's
  // behaviour, every kind, when no part was chosen.
  const includedTypes = part ? TIME_OF_DAY_VENUE_KINDS[part] : undefined;
  const pools = await Promise.all(
    deriveSearchCentres(origins).map((centre) =>
      searchNeighbourhoodCached(centre, SEARCH_RADIUS_METERS, includedTypes)
    )
  );
  // `buildShortlist` dedupes, so the pools are merged and not reconciled.
  // Blocked venues come out here rather than at the end: a venue that may
  // not be proposed should not first cost an Enterprise-tier details call.
  const found = pools
    .flat()
    .filter((candidate) => !blocked.venues.has(candidate.placeId));
  if (found.length === 0) {
    throw new NoSolutionError(
      `no venue near ${meetingId}'s group is still on the table`
    );
  }

  // First pass — no hours anywhere, so every candidate looks open all window.
  // Its only job is to choose whose Enterprise-tier details are worth buying.
  const provisional = buildShortlist({
    candidates: found,
    participants,
    slots,
  });

  await reportStage("venue_details");
  const detailed = await Promise.all(
    provisional.shortlist.map(async (score) => ({
      candidate: score.candidate,
      details: await fetchPlaceDetailsCached(score.candidate.placeId),
    }))
  );
  const priced: Candidate[] = detailed.map(({ candidate, details }) => ({
    ...candidate,
    rating: details.rating,
    openingHours: details.openingHours,
    summary: details.summary,
  }));
  const venueSoftFacts = venueSoftFactsFrom(
    detailed.map(({ candidate, details }) => ({
      placeId: candidate.placeId,
      budget: details.budget,
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
    throw new NoSolutionError(
      `nothing survived the filter for ${meetingId} — ${shortlisted.droppedPairs.length} pairs dropped, ${shortlisted.gatedOut.length} gated out, ${blocked.venues.size} venues and ${blocked.pairs.size} pairs already rejected`
    );
  }

  // Which run this is, counted from the runs themselves. It cannot come from
  // `Meeting.cycleCount`, which counts something else — see `runCycle`.
  const cycleNumber =
    (meeting.matchRuns[meeting.matchRuns.length - 1]?.cycleNumber ?? 0) + 1;

  return {
    input: {
      meetingId,
      cycleNumber,
      occasion: meeting.occasion,
      participants,
      candidates: ranked.map((score) => score.candidate),
      viable,
      ranked,
      rejections,
      // `venueFacts` stays absent rather than empty: B7 fetches no dietary
      // tags, and an empty object would tell A2 and A4 that nothing is true
      // of these venues rather than that nothing is known (the rule
      // `findRejectedOption` follows). `venueSoftFacts` is the same: only
      // what Google actually said, and absent when it said nothing (#139).
      ...(venueSoftFacts ? { venueSoftFacts } : {}),
    },
    contextIds: meeting.participantContexts.map((row) => row.id),
  };
}

/**
 * What is known about each venue's soft side, keyed by place id. A venue with
 * nothing known is left out entirely and, when nothing at all is known,
 * `undefined` is returned so the caller omits the field: an empty object
 * would assert that nothing is true of these venues (#86, #139). Today only
 * `budget` can be sourced (from `priceLevel`); the other three have no
 * source yet and are not invented.
 */
export function venueSoftFactsFrom(
  venues: { placeId: string; budget?: VenueSoftFacts["budget"] }[]
): Record<string, VenueSoftFacts> | undefined {
  const facts: Record<string, VenueSoftFacts> = {};
  for (const venue of venues) {
    if (venue.budget) facts[venue.placeId] = { budget: venue.budget };
  }
  return Object.keys(facts).length > 0 ? facts : undefined;
}

/* -------------------------------------------------------------------------
 * One cycle, start to finish
 * ---------------------------------------------------------------------- */

/**
 * Assemble, ask, write. The five lines that were missing between everything
 * A4 built and anything a person can see.
 *
 * ## The four writes, and who was already waiting for each
 *
 * | Write | Waiting | What it showed instead |
 * | ----- | ------- | ---------------------- |
 * | the run and its three options | `persistMatchRun`, written in A4 and never called | "no proposal yet" |
 * | `MatchRunSeenContext` | [`meeting-detail.ts`](../db/meeting-detail.ts)'s timeline | a re-weighing with no reason beside it |
 * | `status = awaiting` | the feed | "re-weighing", forever |
 * | `cycleCount`, `currentDatetime` | C7's remaining count; the feed's sort — **and B5b's conflict query, which filters on `currentDatetime` and therefore never found anything** | no date, no cross-group conflict |
 *
 * All in one transaction, because a run persisted without its status update
 * is a meeting stuck on "re-weighing" holding a proposal no screen displays.
 * `currentDatetime` needs no timezone conversion despite B5's note on it:
 * `proposedDatetime` is already an instant.
 *
 * ## Where `stuck` is not
 *
 * A run always leaves the meeting `awaiting`, **including the third one**.
 * The cap is three proposals, and the third is a proposal — flipping to
 * `stuck` as it lands would hand the group an answer they are not allowed to
 * look at. `stuck` belongs to the moment a re-weighing is *asked for* and
 * there is none left, which is `respondToMeeting`'s rejection branch.
 *
 * ## It never throws
 *
 * Its caller is `after()` inside the feed poll, where an unhandled rejection
 * is somebody else's request falling over. Same decision, same reason, as
 * A7's `applyRejection`. Failure comes back as `null`, and what it *meant*
 * is left in the meeting's status:
 *
 * | | Examples | Left as |
 * | --- | --- | --- |
 * | **No solution** — an answer | no window the group shares, nothing survived the filter, nobody still coming | `stuck`, so the group is told instead of being retried at forever |
 * | **Fault** — no answer was reached | no Places key, a participant with no home location ([#132](https://github.com/ron14y-sys/squad_lock/issues/132)), a rejected calendar token, the model failing or timing out, two runs racing for one cycle number | `weighing`, so the next poll tries again |
 *
 * **A fault costs no cycle, and that needs no code**: the run is what counts
 * one, and a run that failed wrote nothing.
 *
 * The order of `assembleRun`'s steps is what keeps a repeating fault cheap —
 * profiles, origins and calendars are all resolved before the first Places
 * call, so a group that cannot be weighed is not billed for being retried.
 */
export async function runCycle(
  meetingId: string,
  now: Date = new Date(),
  busyFor: BusyLookup = fetchBusyForUsers
) {
  try {
    return await weigh(meetingId, now, busyFor);
  } catch (error) {
    if (error instanceof NoSolutionError) {
      await clearStage(meetingId);
      // Conditional on the status, so a meeting somebody closed or cancelled
      // while this was running is not dragged back to `stuck`.
      const claimed = await getPrisma().meeting.updateMany({
        where: { id: meetingId, status: MeetingStatus.weighing },
        data: { status: MeetingStatus.stuck },
      });
      console.warn(`[a8] stuck meeting=${meetingId}`, error.message);
      // Spec §5.5 trigger #5, B8 part two's other `stuck` hook
      // (`respondToMeeting`'s is the cycle-cap one). Gated on `claimed.count`,
      // not just "we're in this branch" -- the same race the status update
      // itself guards against (a meeting somebody closed or cancelled while
      // this ran) would otherwise notify about a status change that didn't
      // actually happen. This is already background code by the time it
      // runs (see the header comment on why `weigh()`'s own trigger is
      // awaited directly, not backgrounded again), so no `after()` here.
      if (claimed.count > 0) {
        await notifyStuck(meetingId);
      }
      return null;
    }

    // B10: a rejected Google refresh token is a fault like any other --
    // the meeting stays in `weighing` -- but unlike a transient one, it
    // will never clear itself. Only `fetchBusy`'s own caller
    // (`fetchBusyForConnections`) knows which participant it was, which is
    // why `error.userId` only exists once it has climbed this far.
    if (error instanceof CalendarAuthError && error.userId) {
      await clearStageAndSetRetry(meetingId, null);
      await handleCalendarAuthFailure(error.userId);
      console.warn(
        `[a8] calendar auth failed meeting=${meetingId} user=${error.userId}`
      );
      return null;
    }

    // B9 part two + #155: one write, clearing the stage and setting (or
    // clearing) the fault's retry cooldown together -- no reason to split
    // what used to be `clearStage` alone into two round trips now that this
    // branch has a second thing to record. `faultRetryNotBefore` is `null`
    // for everything except a rate-limited Gemini call -- see its own
    // header comment for why only that one case gets special treatment.
    await clearStageAndSetRetry(meetingId, faultRetryNotBefore(error, now));

    // One line, greppable, in the shape A1's cost log and A7's extraction
    // failure already use. The meeting stays in `weighing`, so the next poll
    // picks it up again — a missing key is fixed in a minute, and a group
    // should not be told their evening is impossible because of one.
    console.error(`[a8] cycle failed meeting=${meetingId}`, error);
    return null;
  }
}

/**
 * B10: the one-time side effect of a rejected refresh token -- clear it so
 * nobody keeps hitting Google with a token that will never work again, and
 * tell the person whose consent actually needs renewing. Never throws, same
 * convention as `clearStage`/`clearStageAndSetRetry` just above.
 *
 * The `updateMany`'s `googleRefreshToken: { not: null }` guard is an
 * optimistic lock, same trick `runDueMeetings` and B9's
 * `retryDueNotifications` both already use elsewhere: two meetings for the
 * same person can hit this within the same poll, and only the one that
 * actually clears the token (`count > 0`) sends the email -- the other
 * finds it already `null` and does nothing, rather than sending a second
 * "reconnect" email for the same failure.
 */
async function handleCalendarAuthFailure(userId: string) {
  try {
    const claimed = await getPrisma().user.updateMany({
      where: { id: userId, googleRefreshToken: { not: null } },
      data: { googleRefreshToken: null },
    });
    if (claimed.count > 0) {
      await notifyCalendarReconnect(userId);
    }
  } catch (error) {
    console.warn(`[a8] calendar reconnect not handled user=${userId}`, error);
  }
}

/**
 * What `runCycle`'s fault branch should write to `Meeting.retryNotBefore`,
 * given the error that was actually thrown. Pure, so it is tested without a
 * clock beyond the `now` it is handed.
 *
 * Google's own number always wins when the error message carries one
 * (`retryDelayMs`) — true of both an overloaded call and a rate-limited one,
 * and "its own number beats any backoff we invent" is `retryDelayMs`'s own
 * stated reason for existing. Failing that, only `LlmCallError.rateLimited`
 * gets a special-cased wait: a quota wall (Gemini's free tier allows 20
 * requests a **day**, spec §6.4) does not open again in 90 seconds, so
 * retrying it on the flat cooldown is pure waste. A Calendar or Places
 * rate limit (`ExternalRateLimitError`, B9 part four) gets the same
 * treatment with a shorter default (`EXTERNAL_RATE_LIMIT_COOLDOWN_MS`),
 * since those quotas are per-minute rather than per-day. Every other fault —
 * an overloaded call with no explicit delay, a missing credential, any
 * other Calendar or Places error — returns `null` and keeps today's flat
 * `RUN_ATTEMPT_COOLDOWN_MS` as the only guard.
 */
export function faultRetryNotBefore(error: unknown, now: Date): Date | null {
  // B9 part four: Calendar and Places now say so explicitly when they are
  // rate-limited. The service's own `Retry-After` wins, same rule as Gemini's
  // `retry in Xs`; failing that, a short fixed wait -- per-minute quotas are
  // the usual case for both, so far shorter than Gemini's daily wall.
  if (error instanceof ExternalRateLimitError) {
    return new Date(
      now.getTime() + (error.retryAfterMs ?? EXTERNAL_RATE_LIMIT_COOLDOWN_MS)
    );
  }

  if (!(error instanceof LlmCallError)) return null;

  const suggested = retryDelayMs(error.message);
  if (suggested !== null) {
    return new Date(now.getTime() + suggested);
  }

  if (error.rateLimited) {
    return new Date(now.getTime() + RATE_LIMIT_RETRY_COOLDOWN_MS);
  }

  return null;
}

/**
 * Writes each stage onto the meeting (#155). Only while it is `weighing`, so
 * a meeting cancelled mid-run is not marked as working.
 *
 * Progress is cosmetic, so a failed write is logged and the run goes on: the
 * group would rather have a proposal without a progress line than neither.
 */
function stageWriter(meetingId: string): StageReport {
  return async (stage) => {
    try {
      await getPrisma().meeting.updateMany({
        where: { id: meetingId, status: MeetingStatus.weighing },
        data: { runStage: stage },
      });
    } catch (error) {
      console.warn(
        `[a8] stage=${stage} not written meeting=${meetingId}`,
        error
      );
    }
  };
}

/** A run that failed is not in any stage. Never throws, as `runCycle` never does. */
async function clearStage(meetingId: string) {
  try {
    await getPrisma().meeting.updateMany({
      where: { id: meetingId },
      data: { runStage: null },
    });
  } catch (error) {
    console.warn(`[a8] stage not cleared meeting=${meetingId}`, error);
  }
}

/**
 * `clearStage`, plus B9 part two's `retryNotBefore` -- the one write the
 * generic fault branch needs, since a run that failed with a fault is
 * leaving `weighing` behind no more than one that failed with no solution
 * does. No status guard, same as `clearStage`: a meeting someone else moved
 * off `weighing` concurrently is never read by `isDue` again regardless of
 * what either column holds, so there is nothing to race.
 */
async function clearStageAndSetRetry(
  meetingId: string,
  retryNotBefore: Date | null
) {
  try {
    await getPrisma().meeting.updateMany({
      where: { id: meetingId },
      data: { runStage: null, retryNotBefore },
    });
  } catch (error) {
    console.warn(`[a8] stage/retry not cleared meeting=${meetingId}`, error);
  }
}

async function weigh(meetingId: string, now: Date, busyFor: BusyLookup) {
  const reportStage = stageWriter(meetingId);
  const { input, contextIds } = await assembleRun(
    meetingId,
    now,
    busyFor,
    reportStage
  );
  await reportStage("model");
  const { draft, call } = await runMatchingAgent(input);
  await reportStage("saving");

  const top = draft.options.find((option) => option.rank === 1);
  if (!top) {
    // `validateOptions` already requires rank 1 to exist; this is the type
    // narrowing, and a second reader of the same rule.
    throw new Error(`a8: ${meetingId}'s run came back with no rank-1 option`);
  }

  const prisma = getPrisma();

  const { run, landedOnAwaiting } = await prisma.$transaction(async (tx) => {
    const run = await persistMatchRun(draft, call, tx);

    if (contextIds.length > 0) {
      await tx.matchRunSeenContext.createMany({
        data: contextIds.map((contextId) => ({
          matchRunId: run.id,
          contextId,
        })),
      });
    }

    // A rejection or amendment (B11) written while this run was in flight
    // was never in front of the model — `assembleRun` read the rows 6-23
    // seconds ago. Leaving the meeting in `weighing` is what gets it
    // answered, by the next poll.
    //
    // "In flight" is not a window of time here: a `MatchRun`'s `createdAt` is
    // stamped when it is *written*, at the end, so a row made during the run
    // is older than the run that did not see it and no timestamp comparison
    // can tell them apart. The rows this run saw were just recorded above,
    // so the question is simply whether any row is still unseen.
    const unanswered = await tx.participantMeetingContext.count({
      where: {
        meetingId,
        seenByRuns: { none: {} },
      },
    });

    const landedOnAwaiting = unanswered === 0;

    // Every answer was to the proposal this run just replaced (#176) —
    // including one given while the run was in flight.
    await resetResponsesForNewProposal(tx, meetingId);

    await tx.meeting.update({
      where: { id: meetingId },
      data: {
        status: landedOnAwaiting
          ? MeetingStatus.awaiting
          : MeetingStatus.weighing,
        // **`cycleCount` counts rematches, `cycleNumber` counts runs**, and
        // the two are deliberately one apart. Spec §3.1 caps
        // "**reject-and-rematch** cycles" at three, and the first proposal is
        // not a rematch — nobody had rejected anything. So a meeting gets the
        // opening proposal plus three more, and three rejections are all
        // answered rather than two.
        //
        // This is what `remainingCycles` in `meeting-detail.ts` shows C7, and
        // it now reads correctly the moment the first proposal lands: three
        // left, not two.
        //
        // (Spec §6.3's aside that "cycles 2 and 3 of a meeting are pure cache
        // hits" is a remark about caching written against the other reading.
        // With this it is cycles 2, 3 and 4. §3.1 defines the cap.)
        cycleCount: draft.cycleNumber - 1,
        currentDatetime: top.proposedDatetime,
        // The run is over, in the same write that says what it produced.
        runStage: null,
        // B9 part two: a completed call means whatever quota wall blocked
        // an earlier attempt is no longer the story, win or lose this time.
        retryNotBefore: null,
      },
    });

    return { run, landedOnAwaiting };
  });

  // Spec §5.5 trigger #2, fired only once the transaction above has actually
  // committed the meeting onto `awaiting` — never inside it (the binding
  // rule that notification is not part of meeting state, spec §5.5).
  // `weigh()` is already background code by the time it runs (called from
  // `runCycle`, itself called from inside a route's `after()`), so this is
  // awaited directly rather than backgrounded again — there is no HTTP
  // response left to protect. `notifyProposalWaiting` never throws (see its
  // own header comment), so a broken mail provider cannot turn a successful
  // weighing into a failed one.
  if (landedOnAwaiting) {
    await notifyProposalWaiting(meetingId);
  }

  return run;
}

/* -------------------------------------------------------------------------
 * The trigger — which meetings are due, and one poll at a time
 * ---------------------------------------------------------------------- */

/**
 * How long new ParticipantMeetingContext rows -- rejections or amendments --
 * are collected before they are answered with one run.
 *
 * B11: this was rejection-only until amendments needed the identical thing
 * (spec §3.2: "an amendment opens a ~90-second window; further amendments
 * reset it; when it closes, one run covers all of them") -- the same
 * reasoning A8 already had for rejections clustering (below), so one window
 * now serves both rather than two copies of the same idea.
 *
 * Measured from the **first** unanswered row since the last run, not the
 * latest: a fixed window is a thing that can be explained to somebody, and
 * one that reset on every row could keep sliding while objections or
 * amendments trickle in.
 *
 * This is what makes the cap mean anything for a rejection. "A cycle is a
 * proposal" (#125) bounds nothing on its own, because every run produces
 * something new to reject — three rejections twenty seconds apart would
 * otherwise reach the cap in under a minute, with three proposals nobody
 * read. An amendment has no such cap concern (the first is free, spec
 * §3.1), but clusters the same way: several people open the same proposal
 * within the same couple of minutes, and firing one run per amendment would
 * replace it before anyone finished reading it either.
 */
export const CONTEXT_BATCH_MS = 90_000;

/**
 * Every proposal gets this long on screen before it can be replaced.
 *
 * The other half of bounding the cap, and the more useful half: the wait is
 * longest exactly when the proposal is newest, which is when the rest of the
 * group is most likely still to join the same batch. A proposal two hours old
 * that somebody rejects waits only `CONTEXT_BATCH_MS`, because there is
 * nobody left to wait for.
 */
export const MIN_PROPOSAL_LIFETIME_MS = 5 * 60_000;

/**
 * How long a meeting is left alone after somebody last touched it.
 *
 * Not a product rule — a guard against the feed's own polling. C5 polls every
 * three seconds while a meeting on screen is `weighing`, and a run takes 6-23
 * seconds, so without this roughly five polls would each start their own run
 * of the same cycle. `MatchRun` is unique on `(meetingId, cycleNumber)` so
 * only one could ever be written, but all five would pay: five calls out of
 * Gemini's twenty a day, and five times the Places quota.
 *
 * It doubles as the retry interval. A fault leaves the meeting in `weighing`
 * for the next poll (step 5), and without a cooldown "the next poll" is three
 * seconds later, forever.
 */
export const RUN_ATTEMPT_COOLDOWN_MS = 90_000;

/**
 * B9 part two — how long to wait before retrying a meeting whose fault was
 * Gemini's own quota wall (`LlmCallError.rateLimited`), when the error
 * message gave no `retry in Xs` figure of its own (`retryDelayMs`) to use
 * instead. The free tier's quota is daily (spec §6.4's 20 requests/day) and
 * nothing here knows the exact reset time, so this is a conservative
 * "check back later" rather than a computed one — long enough that it stops
 * hammering the wall, short enough that a quota freed early in the day is
 * not left idle until tomorrow.
 */
export const RATE_LIMIT_RETRY_COOLDOWN_MS = 60 * 60_000;

/**
 * B9 part four -- how long to leave a meeting alone after Calendar or Places
 * answered 429 with no `Retry-After` of its own. Ten minutes: those quotas
 * are per-minute, so this is generous, and a failed request costs nothing
 * against them, so being wrong in either direction is cheap.
 */
export const EXTERNAL_RATE_LIMIT_COOLDOWN_MS = 10 * 60_000;

export type DueInput = {
  /** Last time anything wrote to the meeting — including a claim. */
  updatedAt: Date;
  /** When the current proposal was made, or null if there is none yet. */
  lastRunAt: Date | null;
  /**
   * The earliest ParticipantMeetingContext row **no run has seen yet**, if
   * any -- a rejection or an amendment, whichever is older (B11: this used
   * to be rejections only; see `CONTEXT_BATCH_MS`'s own comment for why one
   * field now covers both).
   *
   * Not "since the last run": a `MatchRun` is stamped when it is written, so
   * a row written while a run was in flight is older than the run that
   * never saw it. `MatchRunSeenContext` records what each run read, which
   * answers the question exactly instead of approximately.
   */
  firstUnseenContextAt: Date | null;
  /**
   * B9 part two — set only after a rate-limited fault (`faultRetryNotBefore`),
   * `null` otherwise. When set, no attempt is due before it, however long
   * ago `updatedAt` was — see `Meeting.retryNotBefore`'s own comment.
   */
  retryNotBefore: Date | null;
};

/**
 * Is this meeting waiting for a run right now?
 *
 * Pure, so the timers above can be tested without a database, a clock or a
 * model. The caller has already narrowed to `status === "weighing"` —
 * `awaiting` means a proposal is out and nobody has objected or amended, and
 * `stuck`, `closed` and `cancelled` are not weighed again.
 */
export function isDue(meeting: DueInput, now: Date): boolean {
  if (now.getTime() - meeting.updatedAt.getTime() < RUN_ATTEMPT_COOLDOWN_MS) {
    return false;
  }

  if (
    meeting.retryNotBefore !== null &&
    now.getTime() < meeting.retryNotBefore.getTime()
  ) {
    return false;
  }

  // Nothing has ever been proposed. Normally step 7 runs the first cycle at
  // initiation; reaching here means that run failed, so this is the retry.
  if (!meeting.lastRunAt) return true;

  // A proposal is out and the meeting is in `weighing`, which only a
  // rejection or an amendment does. Nothing unanswered means neither has
  // been written down yet.
  if (!meeting.firstUnseenContextAt) return false;

  return (
    now.getTime() >=
      meeting.firstUnseenContextAt.getTime() + CONTEXT_BATCH_MS &&
    now.getTime() >= meeting.lastRunAt.getTime() + MIN_PROPOSAL_LIFETIME_MS
  );
}

/**
 * Run whatever this group is waiting on, at most one attempt per meeting.
 *
 * Called from the feed's own `GET` through `after()`, so the poll answers
 * immediately and the work happens behind it — no cron and no background job,
 * which is what spec §3.2 asks for. The next poll, three seconds later, sees
 * the result.
 *
 * Claiming is an optimistic lock on `updatedAt`: the conditional write
 * succeeds for exactly one caller, and it moves the timestamp the cooldown
 * reads. No new column, and no way for two polls to weigh the same cycle.
 *
 * Meetings are run one after another rather than in parallel — two runs at
 * once is two Gemini calls at once, out of twenty a day.
 */
export async function runDueMeetings(
  groupId: string,
  now: Date = new Date()
): Promise<void> {
  const prisma = getPrisma();

  const candidates = await prisma.meeting.findMany({
    where: { groupId, status: MeetingStatus.weighing },
    select: {
      id: true,
      updatedAt: true,
      retryNotBefore: true,
      matchRuns: {
        orderBy: { cycleNumber: "desc" },
        take: 1,
        select: { createdAt: true },
      },
      participantContexts: {
        // The oldest row no run has read yet, rejection or amendment alike
        // (B11). Letting the database answer "unseen" beats filtering by
        // time in here, which cannot tell a row made during a run from one
        // made before it.
        where: { seenByRuns: { none: {} } },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });

  for (const meeting of candidates) {
    const lastRunAt = meeting.matchRuns[0]?.createdAt ?? null;
    const firstUnseenContextAt =
      meeting.participantContexts[0]?.createdAt ?? null;

    if (
      !isDue(
        {
          updatedAt: meeting.updatedAt,
          lastRunAt,
          firstUnseenContextAt,
          retryNotBefore: meeting.retryNotBefore,
        },
        now
      )
    ) {
      continue;
    }

    const claimed = await prisma.meeting.updateMany({
      where: {
        id: meeting.id,
        status: MeetingStatus.weighing,
        updatedAt: meeting.updatedAt,
      },
      // A write that changes nothing, for the `updatedAt` it moves.
      data: { status: MeetingStatus.weighing },
    });
    if (claimed.count === 0) continue;

    await runCycle(meeting.id, now);
  }
}

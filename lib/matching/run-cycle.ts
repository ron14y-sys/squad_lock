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
import { persistMatchRun } from "@/lib/db/match-run";
import { MeetingStatus } from "@/lib/generated/prisma/enums";
import { commonFreeWindows } from "./availability";
import { runMatchingAgent } from "./agent";
import { originOf } from "./distance";
import { pairId } from "./schemas";
import type { ExtractionOutcome } from "@/lib/generated/prisma/enums";
import { buildShortlist } from "./funnel";
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
 * `contextIds` is every context row it read, which is exactly what
 * `MatchRunSeenContext` records — the join C6's timeline reads to say *why* a
 * re-weighing happened. The pairs it dropped still have no caller and so
 * still have no place here; step 5 gives them one.
 */
export type AssembledRun = {
  input: MatchAgentInput;
  contextIds: string[];
};

export async function assembleRun(
  meetingId: string,
  now: Date = new Date()
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
    throw new NoSolutionError(
      `nothing survived the filter for ${meetingId} — ${shortlisted.droppedPairs.length} pairs dropped, ${shortlisted.gatedOut.length} gated out, ${blocked.venues.size} venues and ${blocked.pairs.size} pairs already rejected`
    );
  }

  return {
    input: {
      meetingId,
      cycleNumber: meeting.cycleCount + 1,
      occasion: meeting.occasion,
      participants,
      candidates: ranked.map((score) => score.candidate),
      viable,
      ranked,
      rejections,
      // `venueFacts` and `venueSoftFacts` stay absent rather than empty: B7
      // fetches neither dietary tags nor atmosphere, and an empty object
      // would tell A2 and A4 that nothing is true of these venues rather
      // than that nothing is known (the rule `findRejectedOption` follows).
    },
    contextIds: meeting.participantContexts.map((row) => row.id),
  };
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
export async function runCycle(meetingId: string, now: Date = new Date()) {
  try {
    return await weigh(meetingId, now);
  } catch (error) {
    if (error instanceof NoSolutionError) {
      // Conditional on the status, so a meeting somebody closed or cancelled
      // while this was running is not dragged back to `stuck`.
      await getPrisma().meeting.updateMany({
        where: { id: meetingId, status: MeetingStatus.weighing },
        data: { status: MeetingStatus.stuck },
      });
      console.warn(`[a8] stuck meeting=${meetingId}`, error.message);
      return null;
    }

    // One line, greppable, in the shape A1's cost log and A7's extraction
    // failure already use. The meeting stays in `weighing`, so the next poll
    // picks it up again — a missing key is fixed in a minute, and a group
    // should not be told their evening is impossible because of one.
    console.error(`[a8] cycle failed meeting=${meetingId}`, error);
    return null;
  }
}

async function weigh(meetingId: string, now: Date) {
  const { input, contextIds } = await assembleRun(meetingId, now);
  const { draft, call } = await runMatchingAgent(input);

  const top = draft.options.find((option) => option.rank === 1);
  if (!top) {
    // `validateOptions` already requires rank 1 to exist; this is the type
    // narrowing, and a second reader of the same rule.
    throw new Error(`a8: ${meetingId}'s run came back with no rank-1 option`);
  }

  const prisma = getPrisma();

  return prisma.$transaction(async (tx) => {
    const run = await persistMatchRun(draft, call, tx);

    if (contextIds.length > 0) {
      await tx.matchRunSeenContext.createMany({
        data: contextIds.map((contextId) => ({
          matchRunId: run.id,
          contextId,
        })),
      });
    }

    await tx.meeting.update({
      where: { id: meetingId },
      data: {
        status: MeetingStatus.awaiting,
        // A cycle is a proposal (#125), so this is the one place it is
        // counted. `MatchRun` is unique on (meetingId, cycleNumber), so two
        // runs racing for the same number make the second transaction fail
        // rather than writing two histories of one weighing.
        cycleCount: draft.cycleNumber,
        currentDatetime: top.proposedDatetime,
      },
    });

    return run;
  });
}

/**
 * One eval scenario as a real meeting, so the follow-up is produced by A8's
 * actual loop rather than by a harness that imitates it.
 *
 * `scenarioFollowupInput` used to build the second cycle by hand: it removed
 * the rejected venue from `viable`, put the correction on the rejecting
 * participant, and set `cycleNumber` to 2. Every one of those three was a
 * guess about what A8 would do, written before A8 existed — and a fixture
 * that states what the code will do is the shape of mistake
 * [#86](https://github.com/ron14y-sys/squad_lock/issues/86) was. So the guess
 * is gone, and the scenario is seeded into Postgres and run through
 * `runCycle` instead: the rejection goes through `respondToMeeting` and A7,
 * the blocking through `blockedByRejections`, the correction through
 * `mergeContexts`, and the result is persisted and read back out.
 *
 * ## What is injected, and why only these two
 *
 * **Places, through its own cache.** `place_search_cache` and
 * `place_details_cache` are seeded from the scenario's `candidateVenues`, so
 * `searchNeighbourhoodCached` and `fetchPlaceDetailsCached` return without
 * going out. The real funnel runs over real cache rows — nothing is bypassed
 * — and not one request is spent from the 1,000 Enterprise-tier calls a month
 * the three of us share (`.env.example`).
 *
 * **Busy blocks, through `assembleRun`'s one seam.** A scenario states the
 * group's free windows directly; a real run derives them from calendars. So
 * the complement of those windows is handed over as everybody's busy time,
 * which produces exactly the availability the fixture states. A calendar is
 * the one thing a cache cannot stand in for: `fetchBusyForUsers` raises for a
 * participant with no usable refresh token **on purpose** (B6).
 *
 * **`now` is the scenario's own evening**, not the wall clock. Every fixture
 * names a fixed date, and `searchWindow` clamps a pinned day to `now` — so a
 * scenario from a past month would otherwise have no window at all.
 *
 * ## What is not injected
 *
 * `venueSoftFacts`. The adapter passes a scenario's `soft` facts straight to
 * the agent; production has no source for them at all (B7 fetches neither
 * atmosphere nor price), and `assembleRun` therefore omits the field. Running
 * the loop honestly means the agent does not see them here either — see the
 * note on `08` in `judge.ts` for what that costs the measurement.
 */

import { getPrisma } from "@/lib/db/client";
import { saveCachedDetails, saveCachedSearch } from "@/lib/db/places-cache";
import {
  initiateMeeting,
  recordRejectionOutcome,
  respondToMeeting,
} from "@/lib/db/meetings";
import { applyRejection } from "@/lib/extraction/apply-rejection";
import { roundToNeighbourhood } from "@/lib/places/geo";
import {
  deriveSearchCentres,
  SEARCH_RADIUS_METERS,
} from "@/lib/places/search-area";
import { runCycle, type BusyLookup } from "@/lib/matching/run-cycle";
import { MeetingStatus } from "@/lib/generated/prisma/enums";
import type { Candidate, SoftPreferences, TimeSlot } from "@/lib/types";

import {
  instantOf,
  openingWindows,
  scenarioAgentInput,
  scenarioSlots,
  type Scenario,
} from "./adapter";
import type { JudgeableRun } from "./judge";

/** One seeded scenario, and the handle to undo it. */
export type SeededScenario = {
  meetingId: string;
  /** Scenario participant name → database user id. */
  userIds: Map<string, string>;
  /** The evening the fixture is about — what to pass `runCycle` as `now`. */
  now: Date;
  busyFor: BusyLookup;
  cleanup: () => Promise<void>;
};

/**
 * The complement of `free` inside `window` — the busy blocks that leave
 * exactly the scenario's own availability behind.
 *
 * Exported for its own test. It is the one piece of arithmetic in this file,
 * and getting it wrong would not fail: it would quietly hand every scenario a
 * different evening from the one its fixture states, and every verdict after
 * that would be about the wrong question.
 */
export function busyOutside(window: TimeSlot, free: TimeSlot[]): TimeSlot[] {
  const blocks: TimeSlot[] = [];
  let cursor = window.start;

  for (const slot of [...free].sort(
    (a, b) => a.start.getTime() - b.start.getTime()
  )) {
    if (slot.start > cursor) blocks.push({ start: cursor, end: slot.start });
    if (slot.end > cursor) cursor = slot.end;
  }
  if (cursor < window.end) blocks.push({ start: cursor, end: window.end });

  return blocks;
}

/** Tier-1 shape: Essentials+Pro fields only, exactly what a search returns. */
function tierOneCandidates(scenario: Scenario): Candidate[] {
  return scenario.candidateVenues.map((venue) => ({
    placeId: venue.placeId,
    name: venue.name,
    address: `${venue.name}, Tel Aviv`,
    location: venue.coordinates,
    neighbourhood: venue.neighborhood ?? null,
  }));
}

export async function seedScenario(
  scenario: Scenario
): Promise<SeededScenario> {
  if (!scenario.rejection || !scenario.initialProposal) {
    throw new Error(`scenario "${scenario.id}" has no rejection to follow up`);
  }

  const prisma = getPrisma();
  const tag = `eval-${scenario.id}-${Date.now()}`;
  const day = scenario.availability[0].date;
  const now = instantOf(day, "00:00");

  const origins = scenario.participants.map((person) => person.coordinates);
  const centres = deriveSearchCentres(origins);

  const userIds = new Map<string, string>();
  for (const person of scenario.participants) {
    const user = await prisma.user.create({
      data: {
        email: `${tag}-${person.name}@example.invalid`,
        name: person.name,
        googleId: `${tag}-${person.name}`,
        preferenceProfile: {
          create: {
            homeLat: person.coordinates.lat,
            homeLng: person.coordinates.lng,
            homeNeighbourhood: person.neighborhood ?? null,
            toleranceKm: person.toleranceKm,
            softPreferences: person.softPreferences ?? {},
          },
        },
      },
    });
    userIds.set(person.name, user.id);
  }

  const group = await prisma.group.create({
    data: {
      name: tag,
      members: { create: [...userIds.values()].map((userId) => ({ userId })) },
    },
  });

  const cleanup = async () => {
    await prisma.group.deleteMany({ where: { name: tag } });
    await prisma.user.deleteMany({ where: { googleId: { startsWith: tag } } });
    // The search cache is keyed by *neighbourhood* and lives 30 days, so it
    // outlives everything above it. Leaving a real neighbourhood pointing at
    // invented venues would have real meetings proposing them for a month,
    // with no request to Google to explain where they came from.
    for (const centre of centres) {
      const { latKey, lngKey } = roundToNeighbourhood(centre);
      await prisma.placeSearchCache.deleteMany({
        where: { latKey, lngKey, radiusMeters: SEARCH_RADIUS_METERS },
      });
    }
    await prisma.placeDetailsCache.deleteMany({
      where: {
        placeId: { in: scenario.candidateVenues.map((v) => v.placeId) },
      },
    });
  };

  try {
    for (const centre of centres) {
      await saveCachedSearch(
        centre,
        SEARCH_RADIUS_METERS,
        tierOneCandidates(scenario)
      );
    }
    for (const venue of scenario.candidateVenues) {
      await saveCachedDetails(venue.placeId, {
        rating: venue.rating,
        openingHours: openingWindows(venue.openingHours),
      });
    }

    const meeting = await initiateMeeting(group.id, [...userIds.values()][0], {
      date: day,
    });

    await seedFirstProposal(scenario, meeting.id);

    const free = scenarioSlots(scenario);
    return {
      meetingId: meeting.id,
      userIds,
      now,
      busyFor: async (ids, window) => ({
        busy: new Map(ids.map((id) => [id, busyOutside(window, free)])),
        unread: [],
        rejected: [],
      }),
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

/**
 * Cycle 1, as a row rather than as a run.
 *
 * The fixture *states* which venue was on the table when somebody rejected it
 * (`initialProposal`), so re-deriving it would spend a second matching call to
 * rediscover a given — and might not rediscover it, which would leave the
 * rejection pointing at something the scenario never described. The slot is
 * the real one: `scenarioAgentInput`'s own funnel already trims each venue to
 * the hours it can host, and that is where this reads it from.
 */
async function seedFirstProposal(
  scenario: Scenario,
  meetingId: string
): Promise<void> {
  const base = scenarioAgentInput(scenario);

  const venue = scenario.candidateVenues.find(
    (candidate) => candidate.name === scenario.initialProposal?.venue
  );
  if (!venue) {
    throw new Error(
      `scenario "${scenario.id}" proposes "${scenario.initialProposal?.venue}", which is not one of its candidateVenues`
    );
  }

  const pair = base.viable.find(
    (candidate) => candidate.candidatePlaceId === venue.placeId
  );
  if (!pair) {
    throw new Error(
      `scenario "${scenario.id}" proposes "${venue.name}", which its own funnel does not find viable`
    );
  }

  const prisma = getPrisma();
  await prisma.matchRun.create({
    data: {
      meetingId,
      cycleNumber: 1,
      shortlist: [],
      // Before the rejection that is about to be recorded, so
      // `blockedByRejections` can tell which proposal it was about.
      createdAt: new Date(Date.now() - 60_000),
      options: {
        create: {
          rank: 1,
          venuePlaceId: venue.placeId,
          venueName: venue.name,
          venueLat: venue.coordinates.lat,
          venueLng: venue.coordinates.lng,
          proposedDatetime: pair.slot.start,
          proposedEnd: pair.slot.end,
          participantJustifications: {},
          tradeoffs: [],
        },
      },
    },
  });

  await prisma.meeting.update({
    where: { id: meetingId },
    data: {
      status: MeetingStatus.awaiting,
      currentDatetime: pair.slot.start,
    },
  });
}

/**
 * The rejection and the cycle it causes, through the paths the app uses.
 *
 * Returns the run that was persisted, in the shape `judge` reads — so what is
 * judged is what a participant would actually be shown, not an in-memory
 * draft that may never have been written.
 */
export async function rejectAndRerun(
  seeded: SeededScenario,
  scenario: Scenario,
  /**
   * `--agreed`: write this correction instead of extracting one. It goes
   * through `recordRejectionOutcome`, the same writer A7 uses, so the only
   * thing skipped is the model call — the row the next cycle reads is
   * identical either way.
   */
  options: { correction?: SoftPreferences } = {}
): Promise<JudgeableRun | null> {
  const rejector = seeded.userIds.get(scenario.rejection!.by);
  if (!rejector) {
    throw new Error(
      `scenario "${scenario.id}" is rejected by "${scenario.rejection!.by}", who is not one of its participants`
    );
  }

  const words = scenario.rejection!.text;
  await respondToMeeting(seeded.meetingId, rejector, {
    kind: "doesnt_suit",
    reasonText: words,
  });

  if (options.correction) {
    await recordRejectionOutcome(
      seeded.meetingId,
      rejector,
      "soft",
      options.correction,
      words
    );
  } else {
    await applyRejection(seeded.meetingId, rejector, words);
  }

  await runCycle(seeded.meetingId, seeded.now, seeded.busyFor);

  const run = await getPrisma().matchRun.findFirst({
    where: { meetingId: seeded.meetingId, cycleNumber: { gt: 1 } },
    orderBy: { cycleNumber: "desc" },
    include: { options: { orderBy: { rank: "asc" } } },
  });
  if (!run) return null;

  return {
    options: run.options.map((option) => ({
      rank: option.rank,
      venue: { placeId: option.venuePlaceId, name: option.venueName },
      proposedDatetime: option.proposedDatetime,
      proposedEnd: option.proposedEnd,
    })),
  };
}

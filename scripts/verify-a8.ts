/**
 * A8, against the real database: the loop, the cap arithmetic, and the two
 * ways a cycle can fail.
 *
 *   npm run verify:a8
 *
 * Every test in this repo runs with no database, no network and no key —
 * deliberately, because a suite that spends quota is a suite nobody can
 * afford to run twice. That leaves A8's whole point unproven, because what
 * could actually be wrong is not an arithmetic rule but whether a rejection
 * reaches it at all. This script is that half, in the shape
 * `verify-a7-db.ts` already set: it creates its own rows and deletes them in
 * a `finally`, and the group and users cascade so everything below them goes
 * too. Nothing here touches a row it did not create.
 *
 * ## What it costs, and what it does not
 *
 * **Four real matching calls** — one per proposal — out of Gemini's twenty a
 * day. That is the price of proving the sequence end to end, and the count is
 * printed at the end so it is never a surprise.
 *
 * **No Places calls at all.** `place_search_cache` and
 * `place_details_cache` are seeded first, through `saveCachedSearch` and
 * `saveCachedDetails`, so `searchNeighbourhoodCached` and
 * `fetchPlaceDetailsCached` return from cache. That runs the real funnel over
 * real cache rows rather than bypassing either — and it keeps the whole
 * script clear of the 1,000 Enterprise requests a month the three of us
 * share (`.env.example`).
 *
 * **Busy blocks are injected**, through the one seam `assembleRun` exposes.
 * A calendar is the one thing a cache cannot stand in for: B6 makes
 * `fetchBusyForUsers` raise for a participant with no usable refresh token on
 * purpose, and the OAuth keys are not in `.env.local`.
 */

import { getPrisma } from "@/lib/db/client";
import { saveCachedDetails, saveCachedSearch } from "@/lib/db/places-cache";
import { initiateMeeting, respondToMeeting } from "@/lib/db/meetings";
import { applyRejection } from "@/lib/extraction/apply-rejection";
import { roundToNeighbourhood } from "@/lib/places/geo";
import {
  deriveSearchCentres,
  SEARCH_RADIUS_METERS,
} from "@/lib/places/search-area";
import {
  assembleRun,
  runCycle,
  type BusyLookup,
} from "@/lib/matching/run-cycle";
import type { Candidate, LatLng, TimeSlot } from "@/lib/types";

const prisma = getPrisma();
const tag = `a8-verify-${Date.now()}`;

let passed = 0;
let failed = 0;
let skipped = 0;
let modelCalls = 0;

function skip(name: string, why: string): void {
  console.log(`  SKIP  ${name} — ${why}`);
  skipped += 1;
}

function check(name: string, ok: boolean, detail = ""): void {
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`
  );
  if (ok) passed += 1;
  else failed += 1;
}

/* -------------------------------------------------------------------------
 * The evening this all happens on
 * ---------------------------------------------------------------------- */

// Two neighbourhoods a real distance apart, so leximin has something to weigh
// and the burden gate has something to reject.
const FLORENTIN: LatLng = { lat: 32.0553, lng: 34.7658 };
const ROTHSCHILD: LatLng = { lat: 32.0648, lng: 34.7749 };

/** Tomorrow, so the window is always ahead of `now`. */
const PINNED = new Date(
  Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate() + 1
  )
);

/** Open 17:00–24:00 every day, which leaves the three-hour minimum room. */
const ALL_EVENING = [
  {
    weekdays: [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ],
    from: "17:00",
    to: "23:59",
  },
];

function venue(placeId: string, name: string, location: LatLng): Candidate {
  return {
    placeId,
    name,
    address: `${name}, Tel Aviv`,
    location,
    neighbourhood: null,
  };
}

// Four candidates, all reachable, so every cycle has somewhere else to go
// after the previous proposal is blocked. Three rejections need four venues.
const VENUES: Candidate[] = [
  venue("verify-a", "מקום א", FLORENTIN),
  venue("verify-b", "מקום ב", ROTHSCHILD),
  venue("verify-c", "מקום ג", { lat: 32.0601, lng: 34.7702 }),
  venue("verify-d", "מקום ד", { lat: 32.0625, lng: 34.7681 }),
];

/** Nobody is busy. Injected, because a calendar cannot be faked via a cache. */
const FREE: BusyLookup = async (userIds) =>
  new Map(userIds.map((userId) => [userId, [] as TimeSlot[]]));

/** Everybody is busy for the whole window — B6's "empty intersection". */
const ALWAYS_BUSY: BusyLookup = async (userIds, window) =>
  new Map(userIds.map((userId) => [userId, [window]]));

async function makeUser(name: string, home: LatLng | null) {
  const user = await prisma.user.create({
    data: {
      email: `${tag}-${name}@example.invalid`,
      name,
      googleId: `${tag}-${name}`,
      preferenceProfile: {
        create: {
          homeLat: home?.lat ?? null,
          homeLng: home?.lng ?? null,
          homeNeighbourhood: home ? "תל אביב" : null,
          toleranceKm: 8,
        },
      },
    },
  });
  return user;
}

async function statusOf(meetingId: string) {
  return prisma.meeting.findUniqueOrThrow({
    where: { id: meetingId },
    select: { status: true, cycleCount: true, currentDatetime: true },
  });
}

async function topOptionOf(meetingId: string) {
  const run = await prisma.matchRun.findFirst({
    where: { meetingId },
    orderBy: { cycleNumber: "desc" },
    include: { options: { orderBy: { rank: "asc" } }, seenContexts: true },
  });
  return run;
}

/** Reject the current rank-1 option, as a participant actually would. */
async function reject(meetingId: string, userId: string, words: string) {
  await respondToMeeting(meetingId, userId, {
    kind: "doesnt_suit",
    reasonText: words,
  });
  await applyRejection(meetingId, userId, words);
}

async function main(): Promise<void> {
  // Derived before the `try`, because the `finally` deletes the cache rows
  // keyed on them.
  const centres = deriveSearchCentres([FLORENTIN, ROTHSCHILD]);

  const dana = await makeUser("Dana", FLORENTIN);
  const yael = await makeUser("Yael", ROTHSCHILD);
  const group = await prisma.group.create({
    data: {
      name: tag,
      members: { create: [{ userId: dana.id }, { userId: yael.id }] },
    },
  });

  try {
    /* 0 — seed the caches, so not one Places request leaves the machine --- */

    for (const centre of centres) {
      await saveCachedSearch(centre, SEARCH_RADIUS_METERS, VENUES);
    }
    for (const candidate of VENUES) {
      await saveCachedDetails(candidate.placeId, {
        rating: 4.4,
        openingHours: ALL_EVENING as never,
      });
    }
    console.log(
      `\nseeded ${centres.length} search centre(s) and ${VENUES.length} venues — zero Places requests from here on\n`
    );

    const meeting = await initiateMeeting(group.id, dana.id, {
      date: PINNED.toISOString().slice(0, 10),
    });

    /* 1 — what a run is assembled from, with no model call --------------- */

    const { input, contextIds } = await assembleRun(
      meeting.id,
      new Date(),
      FREE
    );

    console.log("assembleRun, before anything is asked of the model:");
    for (const person of input.participants) {
      console.log(
        `  ${person.name.padEnd(6)} from ${person.origin?.lat.toFixed(4)},${person.origin?.lng.toFixed(4)}` +
          `  context=${person.context ? "yes" : "none"}`
      );
    }
    console.log(
      `  cycleNumber ${input.cycleNumber} · ${input.candidates.length} candidates · ` +
        `${input.viable.length} viable pairs · ${contextIds.length} context rows\n`
    );

    check(
      "every participant is assembled with an origin",
      input.participants.length === 2 &&
        input.participants.every((p) => p.origin !== null),
      `${input.participants.length} participants`
    );
    check(
      "the first run is cycle 1 and carries no rejection",
      input.cycleNumber === 1 && !input.rejections?.[dana.id],
      `cycleNumber=${input.cycleNumber}`
    );
    check(
      "the funnel produced viable pairs from the seeded cache",
      input.viable.length > 0,
      `${input.viable.length} pairs`
    );

    /* 2 — the opening proposal, and the four writes ---------------------- */

    await runCycle(meeting.id, new Date(), FREE);
    modelCalls += 1;

    const afterFirst = await statusOf(meeting.id);
    const firstRun = await topOptionOf(meeting.id);

    // A run that never happened is not the same as a run that happened
    // wrongly, and this script has to say which. `runCycle` swallows a fault
    // by design (step 5), so the only evidence here is that no row exists —
    // and every check below this point needs a proposal to look at.
    const modelReachable = firstRun !== null;
    if (!modelReachable) {
      console.log(
        "\n  ⚠️  No run was written. `runCycle` reported a fault, which means" +
          "\n      the model could not be reached — check the [a8] line above." +
          "\n      Everything that needs a proposal is skipped; the two failure" +
          "\n      paths below need no model and still run.\n"
      );
      check(
        "a fault leaves the meeting in weighing, with no cycle spent",
        afterFirst.status === "weighing" && afterFirst.cycleCount === 0,
        `${afterFirst.status}, cycleCount=${afterFirst.cycleCount}`
      );
    }

    if (modelReachable)
      check(
        "a run writes three ranked options",
        firstRun?.options.length === 3,
        `${firstRun?.options.length ?? 0} options`
      );
    if (modelReachable)
      check(
        "the meeting is awaiting, not weighing",
        afterFirst.status === "awaiting",
        afterFirst.status
      );
    if (modelReachable)
      check(
        "currentDatetime is set, so the feed can sort and B5b can find conflicts",
        afterFirst.currentDatetime !== null,
        String(afterFirst.currentDatetime)
      );
    check(
      "the opening proposal spends no rematch",
      afterFirst.cycleCount === 0,
      `cycleCount=${afterFirst.cycleCount}`
    );

    /* 3 — three rejections, three answers, then stuck -------------------- */

    const words = ["לא בא לי אוכל אסיאתי", "וגם לא איטלקי", "פשוט רחוק לי מדי"];
    const rejectedVenues: string[] = [];

    if (!modelReachable) {
      skip("three rejections, three answers, then stuck", "needs a proposal");
    }

    for (let round = 0; modelReachable && round < 3; round += 1) {
      const before = await topOptionOf(meeting.id);
      const top = before!.options.find((o) => o.rank === 1)!;
      rejectedVenues.push(top.venuePlaceId!);

      await reject(meeting.id, dana.id, words[round]);

      const afterReject = await statusOf(meeting.id);
      check(
        `rejection ${round + 1} returns the meeting to weighing`,
        afterReject.status === "weighing",
        afterReject.status
      );
      check(
        `rejection ${round + 1} spends no cycle by itself`,
        afterReject.cycleCount === round,
        `cycleCount=${afterReject.cycleCount}`
      );

      await runCycle(meeting.id, new Date(), FREE);
      modelCalls += 1;

      const afterRun = await statusOf(meeting.id);
      const run = await topOptionOf(meeting.id);
      const newTop = run!.options.find((o) => o.rank === 1)!;

      check(
        `proposal ${round + 2} is a different venue`,
        !rejectedVenues.includes(newTop.venuePlaceId!),
        `${newTop.venueName} (rejected: ${rejectedVenues.join(", ")})`
      );
      check(
        `proposal ${round + 2} spends rematch ${round + 1}`,
        afterRun.cycleCount === round + 1 && run!.cycleNumber === round + 2,
        `cycleCount=${afterRun.cycleCount}, cycleNumber=${run!.cycleNumber}`
      );
      check(
        `run ${round + 2} records which context rows it saw`,
        run!.seenContexts.length > 0,
        `${run!.seenContexts.length} rows`
      );
    }

    if (modelReachable) {
      // The fourth rejection has nowhere to go.
      await reject(meeting.id, dana.id, "עדיין לא מתאים");
      const exhausted = await statusOf(meeting.id);
      check(
        "the fourth rejection reaches the cap and the meeting is stuck",
        exhausted.status === "stuck" && exhausted.cycleCount === 3,
        `${exhausted.status}, cycleCount=${exhausted.cycleCount}`
      );

      const sentences = await prisma.participantMeetingContext.findMany({
        where: { meetingId: meeting.id, NOT: { rejectionText: null } },
        orderBy: { createdAt: "asc" },
        select: { rejectionText: true },
      });
      check(
        "every sentence survived, not just the last",
        sentences.length === 4,
        `${sentences.length} kept: ${sentences.map((s) => s.rejectionText).join(" | ")}`
      );
    }

    /* 4 — no solution is not the same as a fault ------------------------- */

    const busyMeeting = await initiateMeeting(group.id, dana.id, {
      date: PINNED.toISOString().slice(0, 10),
    });
    await runCycle(busyMeeting.id, new Date(), ALWAYS_BUSY);
    const busyResult = await statusOf(busyMeeting.id);
    check(
      "a group with no shared window is stuck, with no cycle spent",
      busyResult.status === "stuck" && busyResult.cycleCount === 0,
      `${busyResult.status}, cycleCount=${busyResult.cycleCount}`
    );

    const noHome = await makeUser("NoHome", null);
    await prisma.groupMember.create({
      data: { groupId: group.id, userId: noHome.id },
    });
    const faultMeeting = await initiateMeeting(group.id, noHome.id, {
      date: PINNED.toISOString().slice(0, 10),
    });
    await runCycle(faultMeeting.id, new Date(), FREE);
    const faultResult = await statusOf(faultMeeting.id);
    check(
      "a participant with no home location is a fault, so the meeting waits",
      faultResult.status === "weighing" && faultResult.cycleCount === 0,
      `${faultResult.status}, cycleCount=${faultResult.cycleCount}`
    );
    check(
      "and no run was written for it",
      (await prisma.matchRun.count({
        where: { meetingId: faultMeeting.id },
      })) === 0
    );
  } finally {
    await prisma.group.deleteMany({ where: { name: tag } });
    await prisma.user.deleteMany({ where: { googleId: { startsWith: tag } } });

    // The seeded cache rows have to go, and this is the half that is easy to
    // forget: the search cache is keyed by *neighbourhood*, not by anything
    // belonging to this script, and it lives 30 days. Leaving Florentin and
    // Rothschild pointing at four invented venues would have a real meeting
    // proposing them for a month, with no request to Google to explain where
    // they came from.
    for (const centre of centres) {
      const { latKey, lngKey } = roundToNeighbourhood(centre);
      await prisma.placeSearchCache.deleteMany({
        where: { latKey, lngKey, radiusMeters: SEARCH_RADIUS_METERS },
      });
    }
    await prisma.placeDetailsCache.deleteMany({
      where: { placeId: { startsWith: "verify-" } },
    });
    await prisma.$disconnect();
  }

  console.log(
    `\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ""} · ` +
      `${modelCalls} matching call(s) attempted · 0 Places requests\n`
  );
  if (failed > 0) process.exitCode = 1;
}

void main();

/**
 * The one deliberate real Places run (tasks/a8-plan.md §5).
 *
 *   npm run verify:a8-places
 *
 * ## Read this before running it
 *
 * The binding SKU tier is **Enterprise: 1,000 requests a month for the whole
 * Google Cloud project**, shared by the three of us (spec §6.3,
 * `.env.example`). `fetchPlaceDetails` asks for `rating` and
 * `regularOpeningHours`, both Enterprise, and it is **one request per
 * shortlisted place** — `SHORTLIST_SIZE` is 24. So a single uncached run can
 * spend 24 of the 1,000, and this script is the only thing in the repo that
 * is allowed to spend any. Everything else — every test, every eval,
 * `verify:a8` — runs on a seeded cache.
 *
 * **It counts requests rather than trusting this comment.** `globalThis.fetch`
 * is wrapped for the duration, so the number printed at the end is the number
 * of HTTP requests that actually left the machine, split by endpoint. If the
 * field mask ever grows a tier, the count is what will say so.
 *
 * ## What it leaves behind, on purpose
 *
 * The users, group and meeting are deleted in a `finally`. **The Places cache
 * rows are kept**, and that is the point rather than an oversight: they hold
 * real Google data for a real neighbourhood, keyed by rounded coordinates and
 * shared across every meeting and user (30 days for a search, 24 hours for
 * details). Deleting them would throw away the only thing this run bought.
 *
 * Calendars are still injected. There are no OAuth credentials in
 * `.env.local`, and `fetchBusyForUsers` raises for a participant with no
 * usable refresh token on purpose (B6) — so this run makes Places real and
 * nothing else.
 */

import { getPrisma } from "@/lib/db/client";
import { initiateMeeting } from "@/lib/db/meetings";
import { runCycle, type BusyLookup } from "@/lib/matching/run-cycle";
import { deriveSearchCentres } from "@/lib/places/search-area";
import type { LatLng, TimeSlot } from "@/lib/types";

const prisma = getPrisma();
const tag = `a8-places-${Date.now()}`;

/** Two real Tel Aviv neighbourhoods — real restaurants, no park, no sea (B7b). */
const FLORENTIN: LatLng = { lat: 32.0553, lng: 34.7658 };
const ROTHSCHILD: LatLng = { lat: 32.0648, lng: 34.7749 };

const PINNED = new Date(
  Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate() + 1
  )
);

const FREE: BusyLookup = async (userIds) => ({
  busy: new Map(userIds.map((userId) => [userId, [] as TimeSlot[]])),
  unread: [],
  rejected: [],
});

/** Every Places request that actually left the machine, by endpoint. */
const requests = { search: 0, details: 0, other: 0 };

function countPlacesRequests(): () => void {
  const real = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : String((input as Request).url ?? input);
    if (url.includes("places.googleapis.com")) {
      if (url.includes(":searchText")) requests.search += 1;
      else if (url.includes("/v1/places/")) requests.details += 1;
      else requests.other += 1;
    }
    return real(input, init);
  };

  return () => {
    globalThis.fetch = real;
  };
}

async function makeUser(name: string, home: LatLng) {
  return prisma.user.create({
    data: {
      email: `${tag}-${name}@example.invalid`,
      name,
      googleId: `${tag}-${name}`,
      preferenceProfile: {
        create: {
          homeLat: home.lat,
          homeLng: home.lng,
          homeNeighbourhood: "תל אביב",
          toleranceKm: 8,
        },
      },
    },
  });
}

async function main(): Promise<void> {
  if (!process.env.GOOGLE_PLACES_API_KEY?.trim()) {
    console.error(
      "GOOGLE_PLACES_API_KEY is not set. This script is the one thing here that spends the shared Enterprise allowance, so it does nothing without a key."
    );
    process.exitCode = 1;
    return;
  }

  const centres = deriveSearchCentres([FLORENTIN, ROTHSCHILD]);
  console.log(
    `\n${centres.length} search centre(s) derived from two neighbourhoods — each one a cache miss is one Pro-tier search, and every shortlisted place is one Enterprise-tier details call (≤ ${24} per run).\n`
  );

  const dana = await makeUser("Dana", FLORENTIN);
  const yael = await makeUser("Yael", ROTHSCHILD);
  const group = await prisma.group.create({
    data: {
      name: tag,
      members: { create: [{ userId: dana.id }, { userId: yael.id }] },
    },
  });

  const restore = countPlacesRequests();
  try {
    const meeting = await initiateMeeting(group.id, dana.id, {
      date: PINNED.toISOString().slice(0, 10),
    });

    await runCycle(meeting.id, new Date(), FREE);

    const run = await prisma.matchRun.findFirst({
      where: { meetingId: meeting.id },
      orderBy: { cycleNumber: "desc" },
      include: { options: { orderBy: { rank: "asc" } } },
    });
    const state = await prisma.meeting.findUniqueOrThrow({
      where: { id: meeting.id },
      select: { status: true, currentDatetime: true },
    });

    if (!run) {
      console.log(
        `no run was written — meeting is ${state.status}. See the [a8] line above.`
      );
    } else {
      console.log("real venues, real hours, real ratings:");
      for (const option of run.options) {
        console.log(
          `  ${option.rank}. ${option.venueName}` +
            `  ${option.proposedDatetime.toISOString()} → ${option.proposedEnd.toISOString()}` +
            `\n     ${option.venueAddress ?? "(no address)"}`
        );
      }
      console.log(
        `\nmeeting is ${state.status}, cycle ${run.cycleNumber}, cost ${run.costUsd === null ? "unpriced" : `$${Number(run.costUsd).toFixed(6)}`}`
      );
    }

    const cachedSearches = await prisma.placeSearchCache.count();
    const cachedDetails = await prisma.placeDetailsCache.count();

    console.log(
      `\nPlaces requests that left the machine:\n` +
        `  search  (Essentials+Pro, 5,000/mo)   ${requests.search}\n` +
        `  details (Enterprise,     1,000/mo)   ${requests.details}\n` +
        (requests.other
          ? `  other                                ${requests.other}\n`
          : "") +
        `\ncache now holds ${cachedSearches} search area(s) and ${cachedDetails} place(s) — kept, not cleaned up: ` +
        `that is the only thing these requests bought, and it is shared by every meeting and user nearby.\n` +
        `A repeat of this run inside 30 days spends 0 search requests, and 0 details requests inside 24 hours.\n`
    );
  } finally {
    restore();
    await prisma.group.deleteMany({ where: { name: tag } });
    await prisma.user.deleteMany({ where: { googleId: { startsWith: tag } } });
    await prisma.$disconnect();
  }
}

void main();

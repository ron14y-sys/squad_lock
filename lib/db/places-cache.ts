/**
 * B7 — the two-tier Places cache (spec §6.3).
 *
 * "The search query is a property of a neighbourhood, not of a meeting...
 * Keying the cache on rounded coordinates rather than on a meeting id
 * therefore makes it shared across meetings and users." This file is that
 * cache, sitting between whoever needs venues and `lib/places/client.ts`'s
 * `searchNeighbourhood` / `fetchPlaceDetails` (B7a) — those two stay
 * cache-free and DB-free on purpose (see that file's own header comment);
 * this is the one place that decides *when* to call them.
 *
 * ## Why the two tiers are separate rows, not one
 *
 * Tier 1 (`PlaceSearchCache`) is Essentials+Pro data for a whole search
 * area — long-lived, because a venue's existence and location rarely
 * change. Tier 2 (`PlaceDetailsCache`) is Enterprise data for one place —
 * `rating` and `openingHours`, cached briefly, because "proposing a
 * restaurant that is shut on the night is a real failure" (spec §6.3) and
 * hours drift with holidays and closures in a way a location never does.
 * A single row per (search-area, place) would force both onto the same
 * TTL; keeping them separate lets each expire on its own clock.
 *
 * ## Why every function takes an injectable `client`
 *
 * Same idea as `lib/db/match-run.ts`'s `persistMatchRun` — a parameter
 * defaulting to `getPrisma()` — narrowed further, to only the two methods
 * (`findUnique`, `upsert`) this file actually calls on each delegate,
 * rather than `Pick<PrismaClient, "placeSearchCache" | "placeDetailsCache">`,
 * which would require a test double to implement Prisma's entire delegate
 * interface. This lets the cache-hit/miss/stale branching below be
 * unit-tested against a hand-built fake client — no `DATABASE_URL`, no
 * `describe.skipIf`. `__tests__/places-cache-db.test.ts` covers the part
 * that genuinely needs Postgres: that the Prisma schema and the unique
 * constraint round-trip for real.
 */

import type { Candidate, LatLng, LocalWindow } from "@/lib/types";
import { fetchPlaceDetails, searchNeighbourhood } from "@/lib/places/client";
import { getPrisma } from "./client";
import type { Prisma, PrismaClient } from "@/lib/generated/prisma/client";

type CacheClient = {
  placeSearchCache: Pick<
    PrismaClient["placeSearchCache"],
    "findUnique" | "upsert"
  >;
  placeDetailsCache: Pick<
    PrismaClient["placeDetailsCache"],
    "findUnique" | "upsert"
  >;
};

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

/* -------------------------------------------------------------------------
 * Rounding and freshness — pure, no DB, no clock of their own
 * ---------------------------------------------------------------------- */

/**
 * Decimal places kept in a cache key. `spec §5.4` already stores
 * `PreferenceProfile.home{Lat,Lng}` at this granularity for privacy — "the
 * rounding is already there" (spec §6.3) — but this file rounds again
 * rather than trusting an upstream caller to have matched that precision
 * exactly. Two coordinates that are the *same neighbourhood* but arrived
 * by different paths (a stored home vs. a future B7b union-of-neighbourhoods
 * centre) need to land on the identical key for the unique constraint to
 * ever hit — see the same reasoning `lib/matching/distance.ts`'s
 * `quantise` gives for its own `KEY_DECIMALS`.
 *
 * 2 decimal places of latitude is about 1.1 km; at Tel Aviv's latitude
 * (~32°N) a degree of longitude is narrower, so 2 decimal places there is
 * about 0.9 km — both a reasonable single-neighbourhood cell, not a
 * geographic precision claim.
 */
const KEY_DECIMALS = 2;

const roundCoordinate = (value: number): number => {
  const factor = 10 ** KEY_DECIMALS;
  return Math.round(value * factor) / factor;
};

/** `LatLng` → the exact `(latKey, lngKey)` pair a cache row is looked up by. */
export function roundToNeighbourhood(center: LatLng): {
  latKey: number;
  lngKey: number;
} {
  return {
    latKey: roundCoordinate(center.lat),
    lngKey: roundCoordinate(center.lng),
  };
}

/** "Long" (spec §6.3) — venues rarely stop existing or move. Tunable. */
export const SEARCH_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * "Briefly" (spec §6.3), and well under the "not a week-old cache" bar the
 * B7 acceptance criteria states. Tunable.
 */
export const DETAILS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** `now` is a parameter, not `new Date()`, so this stays clock-free like the rest of the matching code. */
export function isFresh(fetchedAt: Date, ttlMs: number, now: Date): boolean {
  return now.getTime() - fetchedAt.getTime() < ttlMs;
}

/* -------------------------------------------------------------------------
 * Tier 1 — search results
 * ---------------------------------------------------------------------- */

/**
 * The cached search for `(center, radiusMeters)`, or `null` on a miss —
 * either no row, or one older than `SEARCH_CACHE_TTL_MS`. A stale row is
 * left in place rather than deleted: the next `saveCachedSearch` overwrites
 * it, and there is no cost to a row nobody is reading.
 */
export async function getCachedSearch(
  center: LatLng,
  radiusMeters: number,
  client: CacheClient = getPrisma()
): Promise<Candidate[] | null> {
  const { latKey, lngKey } = roundToNeighbourhood(center);

  const row = await client.placeSearchCache.findUnique({
    where: { latKey_lngKey_radiusMeters: { latKey, lngKey, radiusMeters } },
  });
  if (!row || !isFresh(row.fetchedAt, SEARCH_CACHE_TTL_MS, new Date())) {
    return null;
  }

  return row.results as unknown as Candidate[];
}

/** Upserts the row `getCachedSearch` reads — same key, so a re-search after expiry overwrites in place. */
export async function saveCachedSearch(
  center: LatLng,
  radiusMeters: number,
  results: Candidate[],
  client: CacheClient = getPrisma()
): Promise<void> {
  const { latKey, lngKey } = roundToNeighbourhood(center);

  await client.placeSearchCache.upsert({
    where: { latKey_lngKey_radiusMeters: { latKey, lngKey, radiusMeters } },
    create: { latKey, lngKey, radiusMeters, results: asJson(results) },
    update: { results: asJson(results), fetchedAt: new Date() },
  });
}

/**
 * `searchNeighbourhood`, but cache-first — the function everything outside
 * this file should actually call. A miss fetches from `lib/places/client.ts`
 * and writes the cache before returning, so the next call for the same
 * neighbourhood, from any meeting or user, is a pure read.
 */
export async function searchNeighbourhoodCached(
  center: LatLng,
  radiusMeters: number,
  client: CacheClient = getPrisma()
): Promise<Candidate[]> {
  const cached = await getCachedSearch(center, radiusMeters, client);
  if (cached) return cached;

  const results = await searchNeighbourhood(center, radiusMeters);
  await saveCachedSearch(center, radiusMeters, results, client);
  return results;
}

/* -------------------------------------------------------------------------
 * Tier 2 — place details (rating, opening hours)
 * ---------------------------------------------------------------------- */

export type PlaceDetails = { rating?: number; openingHours: LocalWindow[] };

/** The cached details for `placeId`, or `null` on a miss (no row, or older than `DETAILS_CACHE_TTL_MS`). */
export async function getCachedDetails(
  placeId: string,
  client: CacheClient = getPrisma()
): Promise<PlaceDetails | null> {
  const row = await client.placeDetailsCache.findUnique({ where: { placeId } });
  if (!row || !isFresh(row.fetchedAt, DETAILS_CACHE_TTL_MS, new Date())) {
    return null;
  }

  return {
    rating: row.rating ?? undefined,
    openingHours: row.openingHours as unknown as LocalWindow[],
  };
}

/** Upserts the row `getCachedDetails` reads. */
export async function saveCachedDetails(
  placeId: string,
  details: PlaceDetails,
  client: CacheClient = getPrisma()
): Promise<void> {
  await client.placeDetailsCache.upsert({
    where: { placeId },
    create: {
      placeId,
      rating: details.rating ?? null,
      openingHours: asJson(details.openingHours),
    },
    update: {
      rating: details.rating ?? null,
      openingHours: asJson(details.openingHours),
      fetchedAt: new Date(),
    },
  });
}

/**
 * `fetchPlaceDetails`, but cache-first — call this, not the client function
 * directly, for the same reason as `searchNeighbourhoodCached` above.
 */
export async function fetchPlaceDetailsCached(
  placeId: string,
  client: CacheClient = getPrisma()
): Promise<PlaceDetails> {
  const cached = await getCachedDetails(placeId, client);
  if (cached) return cached;

  const details = await fetchPlaceDetails(placeId);
  await saveCachedDetails(placeId, details, client);
  return details;
}

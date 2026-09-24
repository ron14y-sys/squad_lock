import { afterAll, describe, expect, it } from "vitest";

import { getPrisma } from "@/lib/db/client";
import type { Candidate, LatLng } from "@/lib/types";
import {
  getCachedDetails,
  getCachedSearch,
  saveCachedDetails,
  saveCachedSearch,
} from "@/lib/db/places-cache";

/**
 * The one thing `lib/db/places-cache.test.ts` cannot check: that the
 * Prisma schema and its `(latKey, lngKey, radiusMeters)` unique constraint
 * actually round-trip through real Postgres — an upsert on the same key
 * updates in place rather than raising a duplicate-key error, and a `Json`
 * column comes back shaped the way it went in. Same split, same reason, as
 * `__tests__/participant-busy-db.test.ts` next to
 * `lib/calendar/participant-busy.test.ts`.
 *
 * **It skips itself when `DATABASE_URL` is unset**, which today is dev and
 * CI both:
 *
 * ```
 * DATABASE_URL=postgresql://... npx vitest run __tests__/places-cache-db.test.ts
 * ```
 *
 * It writes its own rows under a run-specific key that cannot collide with
 * a real neighbourhood or a real Places id, and deletes them afterwards.
 */

const CONNECTED = Boolean(process.env.DATABASE_URL);

if (!CONNECTED) {
  console.info(
    "[places-cache-db] skipped: DATABASE_URL is not set. This suite covers the round trip through Postgres; lib/db/places-cache.test.ts covers the logic."
  );
}

// Nowhere near a real coastline or city, so it can never collide with a
// genuine search key another test — or a real user — has written.
const CENTER: LatLng = { lat: 1.23, lng: 4.56 };
const RADIUS_M = 1500;
const PLACE_ID = `places-cache-db-test-${Date.now()}`;

describe.skipIf(!CONNECTED)("places cache against a real database", () => {
  const prisma = CONNECTED ? getPrisma() : null;

  afterAll(async () => {
    if (!prisma) return;
    await prisma.placeSearchCache.deleteMany({
      where: { latKey: CENTER.lat, lngKey: CENTER.lng, radiusMeters: RADIUS_M },
    });
    await prisma.placeDetailsCache.deleteMany({ where: { placeId: PLACE_ID } });
  });

  it("round-trips a search result: miss, save, hit", async () => {
    expect(await getCachedSearch(CENTER, RADIUS_M)).toBeNull();

    const candidate: Candidate = {
      placeId: "db-test-place",
      name: "Test Cafe",
      address: "1 Test St",
      location: CENTER,
      neighbourhood: null,
    };
    await saveCachedSearch(CENTER, RADIUS_M, [candidate]);

    expect(await getCachedSearch(CENTER, RADIUS_M)).toEqual([candidate]);
  });

  it("saveCachedSearch twice on the same key upserts, not a duplicate-key error", async () => {
    const first: Candidate = {
      placeId: "db-test-place-1",
      name: "First",
      address: null,
      location: CENTER,
      neighbourhood: null,
    };
    const second: Candidate = {
      placeId: "db-test-place-2",
      name: "Second",
      address: null,
      location: CENTER,
      neighbourhood: null,
    };

    await saveCachedSearch(CENTER, RADIUS_M, [first]);
    await saveCachedSearch(CENTER, RADIUS_M, [second]);

    expect(await getCachedSearch(CENTER, RADIUS_M)).toEqual([second]);
  });

  it("round-trips place details: miss, save, hit", async () => {
    expect(await getCachedDetails(PLACE_ID)).toBeNull();

    await saveCachedDetails(PLACE_ID, {
      rating: 4.2,
      openingHours: [{ weekdays: ["friday"], from: "18:00", to: "23:00" }],
    });

    expect(await getCachedDetails(PLACE_ID)).toEqual({
      rating: 4.2,
      openingHours: [{ weekdays: ["friday"], from: "18:00", to: "23:00" }],
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Candidate, LatLng } from "@/lib/types";
import {
  DETAILS_CACHE_TTL_MS,
  fetchPlaceDetailsCached,
  getCachedDetails,
  getCachedSearch,
  isFresh,
  saveCachedDetails,
  saveCachedSearch,
  searchNeighbourhoodCached,
  SEARCH_CACHE_TTL_MS,
} from "./places-cache";

/**
 * No real database and no real network anywhere in this file. The DB side
 * is a hand-built fake — just the two methods (`findUnique`, `upsert`) this
 * module actually calls, matching `lib/db/match-run.ts`'s
 * `Pick<PrismaClient, ...>` injection so the cache-hit/miss/stale branching
 * is fully covered without `DATABASE_URL`. The network side is `fetch`,
 * mocked the same way as `lib/places/client.test.ts`, exercised only on the
 * miss path so a real client round trip is covered too, not just a stub.
 * `__tests__/places-cache-db.test.ts` is the one place that needs Postgres —
 * proving the Prisma schema and the unique constraint themselves round trip.
 */

const CENTER: LatLng = { lat: 32.081, lng: 34.784 };

function fakeCacheClient() {
  return {
    placeSearchCache: { findUnique: vi.fn(), upsert: vi.fn() },
    placeDetailsCache: { findUnique: vi.fn(), upsert: vi.fn() },
  };
}

function fakeResponse(ok: boolean, body: unknown) {
  return {
    ok,
    status: ok ? 200 : 400,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isFresh", () => {
  const fetchedAt = new Date("2026-09-01T00:00:00.000Z");

  it("is fresh just under the TTL", () => {
    const now = new Date(fetchedAt.getTime() + 1000);
    expect(isFresh(fetchedAt, 2000, now)).toBe(true);
  });

  it("is not fresh exactly at the TTL boundary", () => {
    const now = new Date(fetchedAt.getTime() + 2000);
    expect(isFresh(fetchedAt, 2000, now)).toBe(false);
  });

  it("is not fresh well past the TTL", () => {
    const now = new Date(fetchedAt.getTime() + 999_999);
    expect(isFresh(fetchedAt, 2000, now)).toBe(false);
  });
});

describe("getCachedSearch / saveCachedSearch", () => {
  it("is null on a plain miss — no row at all", async () => {
    const client = fakeCacheClient();
    client.placeSearchCache.findUnique.mockResolvedValue(null);

    expect(await getCachedSearch(CENTER, 1500, undefined, client)).toBeNull();
    expect(client.placeSearchCache.findUnique).toHaveBeenCalledWith({
      where: {
        latKey_lngKey_radiusMeters_includedTypes: {
          latKey: 32.08,
          lngKey: 34.78,
          radiusMeters: 1500,
          includedTypes: "bar,cafe,restaurant",
        },
      },
    });
  });

  it("is null when the row is older than SEARCH_CACHE_TTL_MS", async () => {
    const client = fakeCacheClient();
    client.placeSearchCache.findUnique.mockResolvedValue({
      results: [],
      fetchedAt: new Date(Date.now() - SEARCH_CACHE_TTL_MS - 1000),
    });

    expect(await getCachedSearch(CENTER, 1500, undefined, client)).toBeNull();
  });

  it("returns the cached results when the row is fresh", async () => {
    const candidate: Candidate = {
      placeId: "p1",
      name: "Cafe",
      address: null,
      location: { lat: 32.08, lng: 34.78 },
      neighbourhood: null,
    };
    const client = fakeCacheClient();
    client.placeSearchCache.findUnique.mockResolvedValue({
      results: [candidate],
      fetchedAt: new Date(),
    });

    expect(await getCachedSearch(CENTER, 1500, undefined, client)).toEqual([
      candidate,
    ]);
  });

  it("saveCachedSearch upserts on the rounded key with the results as JSON", async () => {
    const client = fakeCacheClient();
    const candidate: Candidate = {
      placeId: "p1",
      name: "Cafe",
      address: null,
      location: { lat: 32.08, lng: 34.78 },
      neighbourhood: null,
    };

    await saveCachedSearch(CENTER, 1500, [candidate], undefined, client);

    expect(client.placeSearchCache.upsert).toHaveBeenCalledTimes(1);
    const call = client.placeSearchCache.upsert.mock.calls[0][0];
    expect(call.where).toEqual({
      latKey_lngKey_radiusMeters_includedTypes: {
        latKey: 32.08,
        lngKey: 34.78,
        radiusMeters: 1500,
        includedTypes: "bar,cafe,restaurant",
      },
    });
    expect(call.create.results).toEqual([candidate]);
    expect(call.update.results).toEqual([candidate]);
  });

  it("keys a narrower includedTypes list separately, sorted so order doesn't matter (#168)", async () => {
    const client = fakeCacheClient();
    client.placeSearchCache.findUnique.mockResolvedValue(null);

    await getCachedSearch(CENTER, 1500, ["cafe"], client);
    await getCachedSearch(CENTER, 1500, ["bar", "restaurant"], client);

    const calls = client.placeSearchCache.findUnique.mock.calls;
    expect(
      calls[0][0].where.latKey_lngKey_radiusMeters_includedTypes
    ).toMatchObject({ includedTypes: "cafe" });
    expect(
      calls[1][0].where.latKey_lngKey_radiusMeters_includedTypes
    ).toMatchObject({ includedTypes: "bar,restaurant" });
  });
});

describe("searchNeighbourhoodCached", () => {
  it("is a cache hit: returns the cached value and never calls fetch", async () => {
    const candidate: Candidate = {
      placeId: "p1",
      name: "Cafe",
      address: null,
      location: { lat: 32.08, lng: 34.78 },
      neighbourhood: null,
    };
    const client = fakeCacheClient();
    client.placeSearchCache.findUnique.mockResolvedValue({
      results: [candidate],
      fetchedAt: new Date(),
    });

    const results = await searchNeighbourhoodCached(
      CENTER,
      1500,
      undefined,
      client
    );

    expect(results).toEqual([candidate]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is a cache miss: calls the real client over fetch, then saves the result", async () => {
    const client = fakeCacheClient();
    client.placeSearchCache.findUnique.mockResolvedValue(null);
    fetchMock.mockResolvedValueOnce(
      fakeResponse(true, {
        places: [
          {
            id: "p1",
            displayName: { text: "Cafe" },
            location: { latitude: 32.08, longitude: 34.78 },
            businessStatus: "OPERATIONAL",
          },
        ],
      })
    );

    const results = await searchNeighbourhoodCached(
      CENTER,
      1500,
      undefined,
      client
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results.map((c) => c.placeId)).toEqual(["p1"]);
    expect(client.placeSearchCache.upsert).toHaveBeenCalledTimes(1);
    expect(
      client.placeSearchCache.upsert.mock.calls[0][0].create.results
    ).toEqual(results);
  });

  it("passes a narrower includedTypes through to the real client on a miss (#168)", async () => {
    const client = fakeCacheClient();
    client.placeSearchCache.findUnique.mockResolvedValue(null);
    fetchMock.mockResolvedValueOnce(fakeResponse(true, { places: [] }));

    await searchNeighbourhoodCached(CENTER, 1500, ["cafe"], client);

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string).includedTypes).toEqual(["cafe"]);
    expect(
      client.placeSearchCache.upsert.mock.calls[0][0].create.includedTypes
    ).toBe("cafe");
  });
});

describe("getCachedDetails / saveCachedDetails", () => {
  it("is null on a plain miss", async () => {
    const client = fakeCacheClient();
    client.placeDetailsCache.findUnique.mockResolvedValue(null);

    expect(await getCachedDetails("p1", client)).toBeNull();
    expect(client.placeDetailsCache.findUnique).toHaveBeenCalledWith({
      where: { placeId: "p1" },
    });
  });

  it("is null when the row is older than DETAILS_CACHE_TTL_MS", async () => {
    const client = fakeCacheClient();
    client.placeDetailsCache.findUnique.mockResolvedValue({
      rating: 4.5,
      openingHours: [],
      fetchedAt: new Date(Date.now() - DETAILS_CACHE_TTL_MS - 1000),
    });

    expect(await getCachedDetails("p1", client)).toBeNull();
  });

  it("returns rating and openingHours when the row is fresh", async () => {
    const client = fakeCacheClient();
    client.placeDetailsCache.findUnique.mockResolvedValue({
      rating: 4.5,
      openingHours: [{ weekdays: ["sunday"], from: "09:00", to: "22:00" }],
      fetchedAt: new Date(),
    });

    expect(await getCachedDetails("p1", client)).toEqual({
      rating: 4.5,
      openingHours: [{ weekdays: ["sunday"], from: "09:00", to: "22:00" }],
    });
  });

  it("returns a stored budget, and ignores anything that is not one of the two answers", async () => {
    const client = fakeCacheClient();
    client.placeDetailsCache.findUnique.mockResolvedValueOnce({
      rating: null,
      openingHours: [],
      budget: "splurge",
      fetchedAt: new Date(),
    });
    expect((await getCachedDetails("p1", client))?.budget).toBe("splurge");

    client.placeDetailsCache.findUnique.mockResolvedValueOnce({
      rating: null,
      openingHours: [],
      budget: "moderate",
      fetchedAt: new Date(),
    });
    expect((await getCachedDetails("p1", client))?.budget).toBeUndefined();
  });

  it("saveCachedDetails stores the budget, and null when it is not known", async () => {
    const client = fakeCacheClient();

    await saveCachedDetails(
      "p1",
      { openingHours: [], budget: "modest" },
      client
    );
    await saveCachedDetails("p2", { openingHours: [] }, client);

    const calls = client.placeDetailsCache.upsert.mock.calls;
    expect(calls[0][0].create.budget).toBe("modest");
    expect(calls[0][0].update.budget).toBe("modest");
    expect(calls[1][0].create.budget).toBeNull();
  });

  it("stores Google's summary and reads it back, undefined when there is none", async () => {
    const client = fakeCacheClient();

    await saveCachedDetails(
      "p1",
      { openingHours: [], summary: "פסטה טרייה" },
      client
    );
    await saveCachedDetails("p2", { openingHours: [] }, client);

    const calls = client.placeDetailsCache.upsert.mock.calls;
    expect(calls[0][0].create.summary).toBe("פסטה טרייה");
    expect(calls[0][0].update.summary).toBe("פסטה טרייה");
    expect(calls[1][0].create.summary).toBeNull();

    client.placeDetailsCache.findUnique.mockResolvedValueOnce({
      rating: null,
      openingHours: [],
      summary: "פסטה טרייה",
      fetchedAt: new Date(),
    });
    expect((await getCachedDetails("p1", client))?.summary).toBe("פסטה טרייה");

    client.placeDetailsCache.findUnique.mockResolvedValueOnce({
      rating: null,
      openingHours: [],
      summary: null,
      fetchedAt: new Date(),
    });
    expect((await getCachedDetails("p2", client))?.summary).toBeUndefined();
  });

  it("is an undefined rating, not null, when the stored rating is null", async () => {
    const client = fakeCacheClient();
    client.placeDetailsCache.findUnique.mockResolvedValue({
      rating: null,
      openingHours: [],
      fetchedAt: new Date(),
    });

    expect((await getCachedDetails("p1", client))?.rating).toBeUndefined();
  });

  it("saveCachedDetails upserts by placeId, storing a null rating when absent", async () => {
    const client = fakeCacheClient();

    await saveCachedDetails("p1", { openingHours: [] }, client);

    expect(client.placeDetailsCache.upsert).toHaveBeenCalledTimes(1);
    const call = client.placeDetailsCache.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ placeId: "p1" });
    expect(call.create.rating).toBeNull();
  });
});

describe("fetchPlaceDetailsCached", () => {
  it("is a cache hit: returns the cached value and never calls fetch", async () => {
    const client = fakeCacheClient();
    client.placeDetailsCache.findUnique.mockResolvedValue({
      rating: 4.1,
      openingHours: [],
      fetchedAt: new Date(),
    });

    const details = await fetchPlaceDetailsCached("p1", client);

    expect(details).toEqual({ rating: 4.1, openingHours: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is a cache miss: calls the real client over fetch, then saves the result", async () => {
    const client = fakeCacheClient();
    client.placeDetailsCache.findUnique.mockResolvedValue(null);
    fetchMock.mockResolvedValueOnce(fakeResponse(true, { rating: 3.9 }));

    const details = await fetchPlaceDetailsCached("p1", client);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(details).toEqual({ rating: 3.9, openingHours: [] });
    expect(client.placeDetailsCache.upsert).toHaveBeenCalledTimes(1);
  });
});

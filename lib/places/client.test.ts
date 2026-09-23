import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LatLng } from "@/lib/types";
import { fetchPlaceDetails, searchNeighbourhood } from "./client";

/**
 * No real network call ever leaves this file, same discipline as
 * `lib/calendar/freebusy.test.ts` — `fetch` is a mock throughout, and each
 * test asserts on the URL, headers, and body a call actually produced,
 * rather than trusting the implementation not to have drifted.
 */

const CENTER: LatLng = { lat: 32.08, lng: 34.78 };

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

describe("searchNeighbourhood", () => {
  it("calls searchText with the Essentials+Pro field mask, the key, and a location-biased circle", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(true, { places: [] }));

    await searchNeighbourhood(CENTER, 1500);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://places.googleapis.com/v1/places:searchText");
    expect(init.method).toBe("POST");
    expect(init.headers["X-Goog-Api-Key"]).toBe("test-key");
    expect(init.headers["X-Goog-FieldMask"]).toBe(
      "places.id,places.displayName,places.formattedAddress,places.location,places.businessStatus"
    );
    // No Enterprise field anywhere in this mask — that is the whole point.
    expect(init.headers["X-Goog-FieldMask"]).not.toMatch(/rating|OpeningHours/);

    const body = JSON.parse(init.body as string);
    expect(body.textQuery).toBeTruthy();
    expect(body.locationBias.circle.center).toEqual({
      latitude: 32.08,
      longitude: 34.78,
    });
    expect(body.locationBias.circle.radius).toBe(1500);
  });

  it("turns a raw place into a Candidate, with rating and openingHours left unset", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(true, {
        places: [
          {
            id: "place-1",
            displayName: { text: "Cafe Florentin" },
            formattedAddress: "1 Florentin St, Tel Aviv",
            location: { latitude: 32.05, longitude: 34.77 },
            businessStatus: "OPERATIONAL",
          },
        ],
      })
    );

    const candidates = await searchNeighbourhood(CENTER, 1500);

    expect(candidates).toEqual([
      {
        placeId: "place-1",
        name: "Cafe Florentin",
        address: "1 Florentin St, Tel Aviv",
        location: { lat: 32.05, lng: 34.77 },
        neighbourhood: null,
      },
    ]);
    expect(candidates[0]).not.toHaveProperty("rating");
    expect(candidates[0]).not.toHaveProperty("openingHours");
  });

  it("is empty when the response has no places at all", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(true, {}));

    expect(await searchNeighbourhood(CENTER, 1500)).toEqual([]);
  });

  it("drops a permanently closed result", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(true, {
        places: [
          {
            id: "place-closed",
            displayName: { text: "Gone" },
            location: { latitude: 32.05, longitude: 34.77 },
            businessStatus: "CLOSED_PERMANENTLY",
          },
          {
            id: "place-open",
            displayName: { text: "Still here" },
            location: { latitude: 32.06, longitude: 34.78 },
            businessStatus: "OPERATIONAL",
          },
        ],
      })
    );

    const candidates = await searchNeighbourhood(CENTER, 1500);

    expect(candidates.map((c) => c.placeId)).toEqual(["place-open"]);
  });

  it("drops a temporarily closed result", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(true, {
        places: [
          {
            id: "place-1",
            displayName: { text: "Closed for renovation" },
            location: { latitude: 32.05, longitude: 34.77 },
            businessStatus: "CLOSED_TEMPORARILY",
          },
        ],
      })
    );

    expect(await searchNeighbourhood(CENTER, 1500)).toEqual([]);
  });

  it("keeps a result with an unrecognised businessStatus rather than dropping it silently", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(true, {
        places: [
          {
            id: "place-1",
            displayName: { text: "New status Google adds later" },
            location: { latitude: 32.05, longitude: 34.77 },
            businessStatus: "SOMETHING_NEW",
          },
        ],
      })
    );

    expect(
      (await searchNeighbourhood(CENTER, 1500)).map((c) => c.placeId)
    ).toEqual(["place-1"]);
  });

  it("drops a result with no location — distance can't be computed for it", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(true, {
        places: [{ id: "place-1", displayName: { text: "No coordinates" } }],
      })
    );

    expect(await searchNeighbourhood(CENTER, 1500)).toEqual([]);
  });

  it("falls back to the placeId as the name when displayName is missing", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(true, {
        places: [
          {
            id: "place-1",
            location: { latitude: 32.05, longitude: 34.77 },
            businessStatus: "OPERATIONAL",
          },
        ],
      })
    );

    const [candidate] = await searchNeighbourhood(CENTER, 1500);
    expect(candidate.name).toBe("place-1");
    expect(candidate.address).toBeNull();
  });

  it("throws with the status and body when searchText fails", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(false, "quota exceeded"));

    await expect(searchNeighbourhood(CENTER, 1500)).rejects.toThrow(
      /searchText failed \(400\): quota exceeded/
    );
  });
});

describe("fetchPlaceDetails", () => {
  it("calls Place Details with only the Enterprise field mask and the key", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(true, {}));

    await fetchPlaceDetails("place-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://places.googleapis.com/v1/places/place-1");
    expect(init.method).toBe("GET");
    expect(init.headers["X-Goog-Api-Key"]).toBe("test-key");
    expect(init.headers["X-Goog-FieldMask"]).toBe("rating,regularOpeningHours");
  });

  it("returns rating as-is and converts periods to LocalWindows", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(true, {
        rating: 4.3,
        regularOpeningHours: {
          periods: [
            {
              open: { day: 0, hour: 9, minute: 0 },
              close: { day: 0, hour: 22, minute: 30 },
            },
            {
              open: { day: 5, hour: 12, minute: 0 },
              close: { day: 5, hour: 15, minute: 0 },
            },
          ],
        },
      })
    );

    const details = await fetchPlaceDetails("place-1");

    expect(details.rating).toBe(4.3);
    expect(details.openingHours).toEqual([
      { weekdays: ["sunday"], from: "09:00", to: "22:30" },
      { weekdays: ["friday"], from: "12:00", to: "15:00" },
    ]);
  });

  it("treats a period with no close as open until 23:59 that day", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(true, {
        regularOpeningHours: {
          periods: [{ open: { day: 2, hour: 0, minute: 0 } }],
        },
      })
    );

    const details = await fetchPlaceDetails("place-1");

    expect(details.openingHours).toEqual([
      { weekdays: ["tuesday"], from: "00:00", to: "23:59" },
    ]);
  });

  it("is an empty openingHours list, and an undefined rating, when both are absent", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(true, {}));

    const details = await fetchPlaceDetails("place-1");

    expect(details.rating).toBeUndefined();
    expect(details.openingHours).toEqual([]);
  });

  it("throws with the status and body when Place Details fails", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(false, "not found"));

    await expect(fetchPlaceDetails("bad-id")).rejects.toThrow(
      /get place details failed \(400\): not found/
    );
  });
});

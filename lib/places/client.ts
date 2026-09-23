/**
 * B7a — the Google Places (New) client (spec §5.4, §6.3).
 *
 * Same division of labour as B6b's `freebusy.ts`: a thin wrapper, no domain
 * logic, plain `fetch` rather than a client SDK. No caching either — that is
 * the next piece (two-tier, keyed by rounded neighbourhood coordinates),
 * layered on top of this file rather than inside it, so the network shape
 * stays testable with nothing but a mocked `fetch`.
 *
 * **The field mask is the whole cost story (spec §6.3), and the split
 * between the two functions below enforces it structurally, not by
 * convention:**
 *
 * - `searchNeighbourhood` is the broad discovery call. Its field mask is
 *   fixed to Essentials + Pro fields only — id, name, address, location,
 *   `businessStatus`. **No Enterprise field, ever, here** (§6.3 rule 2,
 *   binding): `rating` and `regularOpeningHours` are Enterprise-tier, and a
 *   request is billed at the highest tier any requested field belongs to.
 *   Putting either one in this call would mean paying Enterprise rates for
 *   every candidate in the pool instead of only the shortlist.
 * - `fetchPlaceDetails` is the shortlist call — `rating` and
 *   `regularOpeningHours`, Enterprise-tier, and the type signature only
 *   accepts one `placeId` at a time on purpose: there is no batch form, so a
 *   caller cannot accidentally fetch it for the whole pool.
 *
 * One consequence worth stating rather than hiding: because opening hours
 * are unknown until `fetchPlaceDetails` runs, `searchNeighbourhood`'s
 * `businessStatus` filter (permanently/temporarily closed) is the only
 * "is this venue usable" check available before the shortlist exists. The
 * real "open at the proposed time" check — `trimPairToViableSlots` in
 * `lib/matching/constraints.ts` — can only run after the shortlist's detail
 * fetch, which means a shortlisted candidate can still be dropped there.
 * That is correct, not a bug: §6.3 requires Enterprise fields to be fetched
 * "only for the shortlist... never for the full retrieved pool."
 */

import type { Candidate, LatLng, LocalWeekday, LocalWindow } from "@/lib/types";

const SEARCH_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const DETAILS_ENDPOINT = "https://places.googleapis.com/v1/places";

/**
 * Essentials + Pro only (spec §6.3's table): enough to dedupe (`id`), name
 * and address the venue, compute distance (`location`), and drop a
 * permanently/temporarily closed result (`businessStatus`). Nothing that
 * would push the call into a paid-per-request tier.
 */
const SEARCH_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.businessStatus",
].join(",");

/** Enterprise-tier only — the two fields §6.3 gates to the shortlist. */
const DETAILS_FIELD_MASK = ["rating", "regularOpeningHours"].join(",");

/**
 * What the group is looking for. A constant, not a parameter, so every
 * search across the app costs the same and stays cacheable by location
 * alone — see the header comment on why a per-call query string would
 * defeat the neighbourhood-keyed cache the next piece adds.
 */
const TEXT_QUERY = "restaurant";

const WEEKDAY_BY_GOOGLE_INDEX: LocalWeekday[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

type RawLocation = { latitude: number; longitude: number };

type RawTimePoint = { day: number; hour: number; minute: number };

type RawPeriod = { open: RawTimePoint; close?: RawTimePoint };

type RawPlace = {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: RawLocation;
  businessStatus?: string;
};

type SearchTextResponse = {
  places?: RawPlace[];
};

type PlaceDetailsResponse = {
  rating?: number;
  regularOpeningHours?: {
    periods?: RawPeriod[];
  };
};

/** `9` → `"09:00"`, `undefined` minute treated as `0`. */
function formatTimeOfDay(hour: number, minute: number | undefined): string {
  const h = String(hour).padStart(2, "0");
  const m = String(minute ?? 0).padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * One Google `Period` → one `LocalWindow`. No merging across periods: a
 * venue with a split lunch/dinner schedule produces two `LocalWindow`s on
 * the same weekday, which `Candidate.openingHours` (a plain array) already
 * allows for.
 *
 * A period with no `close` is Google's shape for "open the rest of the
 * day" — treated here as open until `23:59` on `open.day`, not as open
 * indefinitely across days. A venue open 24/7 across the whole week is not
 * specially detected; it comes through as seven such windows, one per day,
 * which is equivalent for every consumer of `LocalWindow` in this codebase.
 */
function parsePeriod(period: RawPeriod): LocalWindow {
  const weekday = WEEKDAY_BY_GOOGLE_INDEX[period.open.day];
  const from = formatTimeOfDay(period.open.hour, period.open.minute);
  const to = period.close
    ? formatTimeOfDay(period.close.hour, period.close.minute)
    : "23:59";
  return { weekdays: [weekday], from, to };
}

/** Raw `regularOpeningHours` → `Candidate["openingHours"]`. */
function parseOpeningHours(
  hours: PlaceDetailsResponse["regularOpeningHours"]
): LocalWindow[] {
  return (hours?.periods ?? []).map(parsePeriod);
}

/**
 * `businessStatus` values this app treats as "not a real candidate" — a
 * result Google still returns because the place exists, but nobody can
 * meet there. Anything else (in practice just `"OPERATIONAL"`, but an
 * unrecognised future value is let through rather than silently dropped)
 * survives to become a `Candidate`.
 */
const UNUSABLE_BUSINESS_STATUSES = new Set([
  "CLOSED_PERMANENTLY",
  "CLOSED_TEMPORARILY",
]);

/**
 * One `RawPlace` → one `Candidate`, or `null` for a place nobody can meet
 * at (permanently/temporarily closed) or missing the fields distance and
 * dedupe depend on.
 *
 * `rating` and `openingHours` are never set here — see the header comment.
 * They stay `undefined`, exactly what `Candidate`'s own type already means
 * by "not yet decided whether we fetch it."
 */
function parseSearchResult(raw: RawPlace): Candidate | null {
  if (
    raw.businessStatus &&
    UNUSABLE_BUSINESS_STATUSES.has(raw.businessStatus)
  ) {
    return null;
  }
  if (!raw.location) {
    return null;
  }

  return {
    placeId: raw.id,
    name: raw.displayName?.text ?? raw.id,
    address: raw.formattedAddress ?? null,
    location: { lat: raw.location.latitude, lng: raw.location.longitude },
    // Neighbourhood is not a Places field — whoever calls this already knows
    // which neighbourhood query produced the result and can attach it.
    neighbourhood: null,
  };
}

function apiKeyHeader(): Record<string, string> {
  return { "X-Goog-Api-Key": process.env.GOOGLE_PLACES_API_KEY ?? "" };
}

/**
 * Every venue Text Search (New) returns near `center`, narrowed to the
 * Essentials + Pro field mask and to operating businesses.
 *
 * `radiusMeters` is a location *bias*, not a hard restriction (Google may
 * still return something slightly outside it) — deriving the right radius
 * from a group's neighbourhoods is B7b's job, not this file's.
 */
export async function searchNeighbourhood(
  center: LatLng,
  radiusMeters: number
): Promise<Candidate[]> {
  const response = await fetch(SEARCH_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-FieldMask": SEARCH_FIELD_MASK,
      ...apiKeyHeader(),
    },
    body: JSON.stringify({
      textQuery: TEXT_QUERY,
      locationBias: {
        circle: {
          center: { latitude: center.lat, longitude: center.lng },
          radius: radiusMeters,
        },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`places: searchText failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as SearchTextResponse;
  const places = data.places ?? [];

  return places
    .map(parseSearchResult)
    .filter((candidate): candidate is Candidate => candidate !== null);
}

/**
 * The Enterprise-tier fields for one shortlisted place: `rating` and
 * `openingHours`, in the shape `trimPairToViableSlots` and the funnel's
 * ranking already expect. Called once per shortlist candidate — never in a
 * loop over the whole search pool (see the header comment).
 */
export async function fetchPlaceDetails(
  placeId: string
): Promise<{ rating?: number; openingHours: LocalWindow[] }> {
  const response = await fetch(`${DETAILS_ENDPOINT}/${placeId}`, {
    method: "GET",
    headers: {
      "X-Goog-FieldMask": DETAILS_FIELD_MASK,
      ...apiKeyHeader(),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `places: get place details failed (${response.status}): ${body}`
    );
  }

  const data = (await response.json()) as PlaceDetailsResponse;

  return {
    rating: data.rating,
    openingHours: parseOpeningHours(data.regularOpeningHours),
  };
}

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

import {
  ExternalRateLimitError,
  retryAfterMsOf,
} from "@/lib/external/rate-limit";
import type {
  Candidate,
  LatLng,
  LocalWeekday,
  LocalWindow,
  SoftPreferences,
} from "@/lib/types";

const SEARCH_ENDPOINT = "https://places.googleapis.com/v1/places:searchNearby";
const DETAILS_ENDPOINT = "https://places.googleapis.com/v1/places";

/**
 * Essentials + Pro only (spec §6.3's table): enough to dedupe (`id`), name
 * and address the venue, compute distance (`location`), and drop a
 * permanently/temporarily closed result (`businessStatus`). Nothing that
 * would push the call into a paid-per-request tier. `primaryTypeDisplayName`
 * ("Italian restaurant") is Pro too, so it costs nothing extra (#163), and
 * so is `types` — the machine-readable list a venue's kind and cuisine are
 * read from (#219).
 */
const SEARCH_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.businessStatus",
  "places.primaryTypeDisplayName",
  "places.types",
].join(",");

/**
 * The fields §6.3 gates to the shortlist. `priceLevel` is in the same tier as
 * the first two, so it rides in the same request (#139). `editorialSummary`
 * is not: it moves this call from Enterprise to Enterprise + Atmosphere, a
 * decision taken in #163 so the proposal can say a few words about the place.
 * `servesVegetarianFood` is in that same Atmosphere tier, so it costs nothing
 * more — and it is the one dietary fact Google has (no kosher, vegan or
 * halal field exists).
 */
const DETAILS_FIELD_MASK = [
  "rating",
  "regularOpeningHours",
  "priceLevel",
  "editorialSummary",
  "servesVegetarianFood",
].join(",");

/**
 * The app is in Hebrew, so names, types and summaries are asked for in
 * Hebrew. Google falls back to its default when it has no Hebrew text.
 */
const LANGUAGE_CODE = "he";

/**
 * What the group is looking for, absent a more specific request. Every
 * search still stays cacheable by location — see the header comment — but
 * `includedTypes` is now a parameter, not a constant (#168): the chosen part
 * of day narrows it (cafés only in the morning), and `getCachedSearch` keys
 * on it precisely so that narrowing is never served the wrong answer.
 *
 * `includedTypes` matches a place's whole type list, so an
 * `italian_restaurant` still counts as a `restaurant`.
 * `includedPrimaryTypes` would not, and would drop most restaurants.
 * Until #165 this was a Text Search for "restaurant", and no bar or café
 * ever came back.
 */
export const DEFAULT_INCLUDED_TYPES = ["restaurant", "bar", "cafe"];

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
  primaryTypeDisplayName?: { text: string };
  types?: string[];
};

type SearchNearbyResponse = {
  places?: RawPlace[];
};

type PlaceDetailsResponse = {
  rating?: number;
  /** Google's enum, e.g. `PRICE_LEVEL_INEXPENSIVE`. */
  priceLevel?: string;
  regularOpeningHours?: {
    periods?: RawPeriod[];
  };
  editorialSummary?: { text: string };
  servesVegetarianFood?: boolean;
};

/**
 * Google's price level, folded onto the two answers the preference game asks
 * (`budget`: modest or splurge, #139).
 *
 * `PRICE_LEVEL_MODERATE` deliberately maps to **nothing**: it has no home in
 * a two-way split, and forcing the middle into one side would assert
 * something the data does not say. Absent, moderate and any value Google adds
 * later all mean "not known" — the same rule `VenueDietaryFacts` follows
 * (#86). `FREE` counts as the cheap side; it is the lowest rung.
 */
export function budgetFromPriceLevel(
  priceLevel: string | undefined
): SoftPreferences["budget"] {
  switch (priceLevel) {
    case "PRICE_LEVEL_FREE":
    case "PRICE_LEVEL_INEXPENSIVE":
      return "modest";
    case "PRICE_LEVEL_EXPENSIVE":
    case "PRICE_LEVEL_VERY_EXPENSIVE":
      return "splurge";
    default:
      return undefined;
  }
}

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
    typeLabel: raw.primaryTypeDisplayName?.text,
    // Always a list, even an empty one: the cache reads a candidate with no
    // `types` key at all as written before #219, and fetches again.
    types: raw.types ?? [],
    // Neighbourhood is not a Places field — whoever calls this already knows
    // which neighbourhood query produced the result and can attach it.
    neighbourhood: null,
  };
}

function apiKeyHeader(): Record<string, string> {
  return { "X-Goog-Api-Key": process.env.GOOGLE_PLACES_API_KEY ?? "" };
}

/**
 * Every restaurant, bar and café Nearby Search (New) returns around
 * `center`, narrowed to the Essentials + Pro field mask and to operating
 * businesses. At most 20, ranked by Google's popularity, with no second page.
 *
 * `radiusMeters` is a hard *restriction*: nothing outside the circle comes
 * back. (Text Search, used before #165, only took it as a bias.) Deriving the
 * right radius from a group's neighbourhoods is B7b's job, not this file's.
 *
 * `includedTypes` defaults to every kind this app ever searches for
 * (`DEFAULT_INCLUDED_TYPES`) — pass a narrower list (#168) to ask Google for
 * only that kind, e.g. `["cafe"]` for a morning meeting, so a scarce kind
 * doesn't lose to more common ones within the same 20-result cap.
 */
export async function searchNeighbourhood(
  center: LatLng,
  radiusMeters: number,
  includedTypes: string[] = DEFAULT_INCLUDED_TYPES
): Promise<Candidate[]> {
  const response = await fetch(SEARCH_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-FieldMask": SEARCH_FIELD_MASK,
      ...apiKeyHeader(),
    },
    body: JSON.stringify({
      includedTypes,
      languageCode: LANGUAGE_CODE,
      locationRestriction: {
        circle: {
          center: { latitude: center.lat, longitude: center.lng },
          radius: radiusMeters,
        },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    const message = `places: searchNearby failed (${response.status}): ${body}`;
    if (response.status === 429) {
      // B9 part four -- RESOURCE_EXHAUSTED: a quota wall, not a bug.
      throw new ExternalRateLimitError(
        "places",
        message,
        retryAfterMsOf(response)
      );
    }
    throw new Error(message);
  }

  const data = (await response.json()) as SearchNearbyResponse;
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
export async function fetchPlaceDetails(placeId: string): Promise<{
  rating?: number;
  openingHours: LocalWindow[];
  budget?: SoftPreferences["budget"];
  summary?: string;
  /** Absent when Google does not say — not known, not "no". */
  servesVegetarianFood?: boolean;
}> {
  const url = `${DETAILS_ENDPOINT}/${placeId}?languageCode=${LANGUAGE_CODE}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "X-Goog-FieldMask": DETAILS_FIELD_MASK,
      ...apiKeyHeader(),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    const message = `places: get place details failed (${response.status}): ${body}`;
    if (response.status === 429) {
      // B9 part four -- RESOURCE_EXHAUSTED: a quota wall, not a bug.
      throw new ExternalRateLimitError(
        "places",
        message,
        retryAfterMsOf(response)
      );
    }
    throw new Error(message);
  }

  const data = (await response.json()) as PlaceDetailsResponse;

  return {
    rating: data.rating,
    openingHours: parseOpeningHours(data.regularOpeningHours),
    budget: budgetFromPriceLevel(data.priceLevel),
    summary: data.editorialSummary?.text,
    servesVegetarianFood: data.servesVegetarianFood,
  };
}

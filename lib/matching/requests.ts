// #221: what people asked for — kinds of place and cuisines — as what the
// search asks Google for and which venues may answer. Pure: a venue is
// judged only by its Places `types`, through the same tables #219 uses to
// tell A4 what a venue is.

import {
  CUISINE_GOOGLE_TYPES,
  VENUE_KIND_GOOGLE_TYPES,
  cuisinesOfTypes,
  venueKindsOfTypes,
} from "@/lib/preferences/vocabulary";
import type { SoftPreferences, TonightCorrection } from "@/lib/types/profile";

/**
 * Whether a correction asks for, or against, a kind of place or a cuisine —
 * the parts the search can act on. A budget alone is not one: Google's
 * `types` say nothing about price, so it stays A4's to weigh.
 */
export function isRequest(
  correction: TonightCorrection | null | undefined
): correction is TonightCorrection {
  return Boolean(
    correction?.venueKinds?.length ||
    correction?.cuisines?.length ||
    correction?.avoidVenueKinds?.length ||
    correction?.avoidCuisines?.length
  );
}

/** Every Google type that answers any of these kinds or cuisines, once each. */
export function googleTypesFor(wants: readonly SoftPreferences[]): string[] {
  const types = wants.flatMap((want) => [
    ...(want.venueKinds ?? []).flatMap((kind) => VENUE_KIND_GOOGLE_TYPES[kind]),
    ...(want.cuisines ?? []).flatMap(
      (cuisine) => CUISINE_GOOGLE_TYPES[cuisine]
    ),
  ]);
  return [...new Set(types)];
}

/**
 * Does a venue answer one person's request for tonight?
 *
 * - A kind asked for must be one of the venue's kinds, and a cuisine asked
 *   for one of its cuisines — both, when both were asked ("an Italian
 *   restaurant" is not any restaurant). Within each, any one value is enough.
 * - An avoided kind or cuisine rules the venue out **unless it also answers
 *   something this person asked for**: avoid means "not only that". A bar
 *   that serves food carries both `bar` and `restaurant`, and "a bar, not a
 *   restaurant" must not lose it.
 */
export function answersRequest(
  types: readonly string[],
  request: TonightCorrection
): boolean {
  const kinds = venueKindsOfTypes(types);
  const cuisines = cuisinesOfTypes(types);
  const kindOk =
    !request.venueKinds?.length ||
    request.venueKinds.some((kind) => kinds.includes(kind));
  const cuisineOk =
    !request.cuisines?.length ||
    request.cuisines.some((cuisine) => cuisines.includes(cuisine));
  const wanted =
    Boolean(request.venueKinds?.some((kind) => kinds.includes(kind))) ||
    Boolean(request.cuisines?.some((cuisine) => cuisines.includes(cuisine)));
  const avoided =
    Boolean(request.avoidVenueKinds?.some((kind) => kinds.includes(kind))) ||
    Boolean(
      request.avoidCuisines?.some((cuisine) => cuisines.includes(cuisine))
    );
  return kindOk && cuisineOk && (!avoided || wanted);
}

/** Does a venue match anything anyone listed in their profile? The soft boost. */
export function matchesAnyPreference(
  types: readonly string[],
  preferences: readonly SoftPreferences[]
): boolean {
  const kinds = venueKindsOfTypes(types);
  const cuisines = cuisinesOfTypes(types);
  return preferences.some(
    (preference) =>
      Boolean(preference.venueKinds?.some((kind) => kinds.includes(kind))) ||
      Boolean(
        preference.cuisines?.some((cuisine) => cuisines.includes(cuisine))
      )
  );
}

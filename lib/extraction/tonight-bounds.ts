// #220: a rejection's distance and time requests, as the numbers a weighing
// uses. A7 returns a number only when the person wrote one; "too far" and
// "too late" come back as directions, and this file is where code — not the
// model — turns a direction into a value, measured against the option that
// was rejected. Pure: no database, no clock.

import type { DistanceRequest, StartRequest } from "./constraint-updater";
import { APP_TIME_ZONE, type LocalTimeOfDay } from "@/lib/types";

/**
 * How much nearer "closer" asks for: the next tolerance is this share of the
 * smaller of the rejected venue's distance and the current tolerance. It
 * always tightens, by a step large enough to move the ranking — a venue at
 * the old distance now costs this person 1.25× what they said is fine.
 */
export const CLOSER_FACTOR = 0.8;

/** Below this a tolerance stops meaning anything in a city; a guard. */
export const MIN_TOLERANCE_KM = 0.5;

/**
 * How far "earlier" or "later" moves the start from the rejected one. Half an
 * hour is the smallest step a person would call different.
 */
export const START_STEP_MS = 30 * 60_000;

/**
 * This meeting's tolerance for the person who asked, or `null` when nothing
 * can be computed — "closer" with no rejected venue or no origin to measure
 * from. The weighing then keeps the profile's, and the venue itself is still
 * blocked (`blockedByRejections`).
 */
export function toleranceFor(
  request: DistanceRequest | null,
  measured: { distanceKm: number | null; currentKm: number }
): number | null {
  if (!request) return null;
  if (request.kind === "max_km") return request.km;
  if (measured.distanceKm === null) return null;
  const next =
    Math.min(measured.distanceKm, measured.currentKm) * CLOSER_FACTOR;
  return Math.max(MIN_TOLERANCE_KM, Math.round(next * 10) / 10);
}

const LOCAL_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function localTimeOf(instant: Date): LocalTimeOfDay {
  return LOCAL_TIME.format(instant) as LocalTimeOfDay;
}

/**
 * This meeting's start bounds for the person who asked. A time the person
 * wrote is taken as it is; a direction becomes a bound half an hour to that
 * side of the rejected start, in local time.
 */
export function startBoundsFor(
  request: StartRequest | null,
  rejectedStart: Date | null
): {
  earliestStart: LocalTimeOfDay | null;
  latestStart: LocalTimeOfDay | null;
} {
  const none = { earliestStart: null, latestStart: null };
  if (!request) return none;
  if (request.notBefore || request.notAfter) {
    return {
      earliestStart: (request.notBefore as LocalTimeOfDay) ?? null,
      latestStart: (request.notAfter as LocalTimeOfDay) ?? null,
    };
  }
  if (!request.direction || !rejectedStart) return none;
  const at = rejectedStart.getTime();
  return request.direction === "earlier"
    ? { ...none, latestStart: localTimeOf(new Date(at - START_STEP_MS)) }
    : { ...none, earliestStart: localTimeOf(new Date(at + START_STEP_MS)) };
}

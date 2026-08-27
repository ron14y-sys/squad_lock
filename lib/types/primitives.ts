/**
 * The small shapes every other type is built from.
 *
 * ## The time rule — read this before adding a field that holds a time
 *
 * Two kinds of time exist in this system, and confusing them is the single
 * most expensive mistake available here (issue #4).
 *
 * - **A machine recorded it** — a Google Calendar free/busy block, a proposed
 *   meeting time, a row's `createdAt`. These are *instants*: a `Date`, UTC
 *   underneath, unambiguous. Calendar free/busy arrives as RFC 3339 and the
 *   database columns are `DateTime`, so no conversion happens on the way in.
 * - **A human stated it** — "no car between 18:00 and 21:00", "Fridays",
 *   the venue's opening hours, the date the initiator pinned. These are
 *   *local wall clock*: a `LocalDate`, a `LocalTimeOfDay`, a `LocalWeekday`.
 *   They carry no zone, because the person who said them did not mean one.
 *
 * `APP_TIME_ZONE` is what turns the second kind into the first. Applying it is
 * a deliberate act at a known edge, never an accident in the middle of a
 * calculation. The edges are:
 *
 * 1. **Google Places opening hours** — weekday + `HHMM`, no zone at all.
 *    Checking a candidate against a slot converts here.
 * 2. **Recurring mobility rules and mobility windows** — "Fridays",
 *    "18:00–21:00". Deciding whether a slot falls inside one converts here.
 * 3. **Anything shown to a user** — every rendered date and time.
 *
 * Israel observes daylight saving, so a bare "19:30" is genuinely ambiguous
 * twice a year. That is the reason the two kinds are different types rather
 * than a convention.
 */

/** IANA zone. Every local↔instant conversion in the app goes through this. */
export const APP_TIME_ZONE = "Asia/Jerusalem";

/** Neighbourhood granularity, never a street address (spec §5.4). */
export type LatLng = {
  lat: number;
  lng: number;
};

/**
 * Kilometres. An alias rather than a brand, so it costs nothing at a call
 * site — its job is to stop `toleranceKm` from being read as a 1–5 scale
 * (spec §5.1: the stored value is kilometres, on purpose).
 */
export type Kilometres = number;

/**
 * A span between two instants. Free/busy blocks, viable meeting windows,
 * everything the funnel scores against.
 */
export type TimeSlot = {
  start: Date;
  end: Date;
};

/** A calendar day with no time and no zone. `YYYY-MM-DD`, in `APP_TIME_ZONE`. */
export type LocalDate = string;

/** A wall-clock time with no date and no zone. `HH:MM`, 24-hour. */
export type LocalTimeOfDay = string;

export type LocalWeekday =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday";

/**
 * A recurring stretch of wall clock — "Fridays, 18:00 to 21:00".
 *
 * `to` before `from` means the window crosses midnight. An empty `weekdays`
 * means every day.
 */
export type LocalWindow = {
  weekdays: LocalWeekday[];
  from: LocalTimeOfDay;
  to: LocalTimeOfDay;
};

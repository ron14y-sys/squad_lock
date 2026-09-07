/**
 * A2 — the hard-constraint filter and the post-check (spec §4.1b, §5.4).
 *
 * Two passes over the same rules, on either side of the agent:
 *
 * 1. **`filterPairs`** runs *before* the agent and drops every
 *    `(venue, time slot)` pair that breaks somebody's hard constraint. The
 *    agent cannot pick a pair it was never shown.
 * 2. **`assertChosenPairAllowed`** runs *after* it answers and re-tests the
 *    pair it chose. A model that "mostly" respects an allergy is not
 *    acceptable, and one agent holding six profiles at once has more chances
 *    to drop a person than a filter does.
 *
 * Everything here is deterministic and pure: no LLM, no network, no clock.
 * The same input always gives the same answer, which is what makes the
 * guarantee testable rather than merely stated.
 *
 * ## Pairs, not venues
 *
 * Every check is against a `(venue, slot)` pair, because the same venue is
 * legal at one hour and illegal at the next — it closes, or somebody loses
 * the car at 18:00. A venue alone is not a thing this file can rule on.
 *
 * ## Where the boundary with A3 is
 *
 * This file answers **"is this pair possible at all"** — a yes/no. A3 answers
 * **"how bad is it for each person"** — the burden number, and the gate on
 * `T` that goes with it (spec §5.4, task B7c). So mobility appears here only
 * in its binary form: a person with *no* mode available at that hour cannot
 * get anywhere, whatever the distance. "Can only walk, so 9 km is too far" is
 * a tolerance, and tolerance belongs to A3 and A12.
 *
 * ## Unknown is not a violation
 *
 * A venue whose opening hours we never fetched is **not** dropped. Google
 * Places charges by field tier and `regularOpeningHours` is Enterprise-tier
 * against the smallest allowance in the model, so for many candidates we will
 * simply not know (spec §5.4, §13.7). Dropping on ignorance would silently
 * shrink the candidate pool to whatever we happened to pay for.
 *
 * Instead every unknown is *reported*, per pair, as an `UnverifiedFact`. A4
 * prefers pairs with nothing unverified, and when it has to fall back to one,
 * it says so to the user — "call ahead to check they are open" — rather than
 * presenting a guess as a fact. See `docs/decisions/hard-constraints.md`.
 */

import type {
  Candidate,
  Kilometres,
  LocalWeekday,
  LocalWindow,
  MobilityMode,
  Participant,
  TimeSlot,
} from "@/lib/types";
import { APP_TIME_ZONE } from "@/lib/types";

/* -------------------------------------------------------------------------
 * Local wall clock against instants
 *
 * A slot is an instant pair — a machine wrote it. Opening hours, unavailable
 * hours and mobility windows are local wall clock — a human said them. The
 * time rule in `lib/types/primitives.ts` names this as one of the three edges
 * where `APP_TIME_ZONE` is applied on purpose. This is that edge.
 *
 * Both are projected onto one axis: minutes since Sunday 00:00 local, 0 to
 * 10079. A window that crosses midnight, or a slot that crosses Saturday
 * night, runs past the end of the axis and is compared with a wrap.
 * ---------------------------------------------------------------------- */

const MINUTES_PER_DAY = 1440;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;

const WEEKDAY_INDEX: Record<LocalWeekday, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const ALL_WEEKDAYS = Object.keys(WEEKDAY_INDEX) as LocalWeekday[];

/** Built once. `Intl.DateTimeFormat` is expensive to construct, cheap to reuse. */
const LOCAL_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  weekday: "long",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Minutes since Sunday 00:00 in `APP_TIME_ZONE`. DST-correct: `Intl` owns the offset. */
function weekMinuteOf(instant: Date): number {
  if (Number.isNaN(instant.getTime())) {
    throw new Error("constraints: an invalid Date reached the filter");
  }

  const parts = LOCAL_PARTS.formatToParts(instant);
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  const weekday = value("weekday").toLowerCase() as LocalWeekday;
  const day = WEEKDAY_INDEX[weekday];
  if (day === undefined) {
    throw new Error(`constraints: unrecognised weekday "${value("weekday")}"`);
  }

  return (
    day * MINUTES_PER_DAY + Number(value("hour")) * 60 + Number(value("minute"))
  );
}

/** `"18:00"` to 1080. Throws rather than guessing — a malformed profile is a bug. */
export function minutesOfDay(time: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time.trim());
  if (!match) {
    throw new Error(`constraints: "${time}" is not an HH:MM wall-clock time`);
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

/** A stretch on the weekly axis. `end` may run past `MINUTES_PER_WEEK`. */
type WeekInterval = { start: number; end: number };

/**
 * A slot placed on the weekly axis. Both ends are converted from the instant
 * separately, so a slot spanning a DST change keeps its true length.
 */
function slotInterval(slot: TimeSlot): WeekInterval {
  const spanMs = slot.end.getTime() - slot.start.getTime();
  if (!(spanMs > 0)) {
    throw new Error("constraints: a time slot must end after it starts");
  }
  if (spanMs >= MINUTES_PER_WEEK * 60_000) {
    throw new Error(
      "constraints: a time slot longer than a week is not a slot"
    );
  }

  const start = weekMinuteOf(slot.start);
  let end = weekMinuteOf(slot.end);
  // Both ends are converted separately, so each is exact across a DST change.
  if (end <= start) end += MINUTES_PER_WEEK;
  return { start, end };
}

/** One interval per weekday the window names. An empty `weekdays` means every day. */
function windowIntervals(window: LocalWindow): WeekInterval[] {
  const from = minutesOfDay(window.from);
  const to = minutesOfDay(window.to);
  const days = window.weekdays.length > 0 ? window.weekdays : ALL_WEEKDAYS;

  return days.map((day) => {
    const base = WEEKDAY_INDEX[day] * MINUTES_PER_DAY;
    // `to` at or before `from` is how "22:00 to 02:00" is written down.
    return {
      start: base + from,
      end: base + to + (to <= from ? MINUTES_PER_DAY : 0),
    };
  });
}

/** The three offsets are the axis wrapping: Saturday night meets Sunday morning. */
const WRAPS = [0, MINUTES_PER_WEEK, -MINUTES_PER_WEEK];

/** Do the two share any minute, counting the wrap across Saturday midnight? */
function intervalsOverlap(a: WeekInterval, b: WeekInterval): boolean {
  return WRAPS.some(
    (shift) => a.start < b.end + shift && b.start + shift < a.end
  );
}

/** Does `outer` hold the whole of `inner`, again allowing for the wrap? */
function intervalContains(outer: WeekInterval, inner: WeekInterval): boolean {
  return WRAPS.some(
    (shift) =>
      outer.start + shift <= inner.start && inner.end <= outer.end + shift
  );
}

/** Does any part of this slot fall inside this recurring local window? */
export function slotOverlapsWindow(
  slot: TimeSlot,
  window: LocalWindow
): boolean {
  const interval = slotInterval(slot);
  return windowIntervals(window).some((w) => intervalsOverlap(interval, w));
}

/** Is the *whole* slot inside one of these windows? Used for opening hours. */
export function windowsCoverSlot(
  windows: LocalWindow[],
  slot: TimeSlot
): boolean {
  const interval = slotInterval(slot);
  // Containment in a single window, not in their union: a slot that spans the
  // gap between lunch and dinner service is not a slot the venue can host.
  return windows.some((window) =>
    windowIntervals(window).some((w) => intervalContains(w, interval))
  );
}

/**
 * Two instants-based spans against each other — a proposed slot and a calendar
 * block. No weekly axis here: both sides are absolute, so it is plain arithmetic.
 */
function slotsOverlap(a: TimeSlot, b: TimeSlot): boolean {
  return (
    a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime()
  );
}

/* -------------------------------------------------------------------------
 * What we know about a venue
 * ---------------------------------------------------------------------- */

/**
 * The dietary side of a candidate, which `Candidate` deliberately does not
 * carry: whether a venue is kosher or can handle a nut allergy is not in the
 * Places fields the funnel is committed to fetching (spec §13.6).
 *
 * Three states per tag, and the third is the point: **known to satisfy**,
 * **known to violate**, and **not known** — which is neither, and never drops
 * a candidate. B7 fills this in from whatever source ends up answering the
 * question; until then every candidate is simply unverified, and A4 is told so.
 *
 * Tags are free text on both sides — `"kosher"`, `"shellfish"` — matched after
 * `normaliseTag`. `lib/types/profile.ts` says the normaliser belongs with the
 * filter rather than with the type. It is `normaliseTag`, below.
 */
export type VenueDietaryFacts = {
  satisfies?: string[];
  violates?: string[];
};

/** Case and padding only. The vocabulary is open, so nothing is mapped away. */
export function normaliseTag(tag: string): string {
  return tag.trim().toLowerCase();
}

/* -------------------------------------------------------------------------
 * Findings
 * ---------------------------------------------------------------------- */

export type ViolationKind =
  /** The chosen venue is not in the pool the agent was given. Fabricated. */
  | "not_a_candidate"
  /** The chosen slot is not one of the slots offered. Also fabricated. */
  | "slot_not_offered"
  /** Known opening hours, and the venue is shut for part of the slot. */
  | "closed"
  /** The person's fixed unavailable hours (spec §5.1). */
  | "unavailable"
  /** A busy block from Google Calendar free/busy. */
  | "busy"
  /** No mobility mode at all at that hour — the binary half of §5.4. */
  | "immobile"
  | "dietary"
  | "allergy";

export type ConstraintViolation = {
  kind: ViolationKind;
  candidatePlaceId: string;
  /** Absent when the violation is the venue's own, not a person's. */
  participantId?: string;
  /** Readable, and the thing a failing test prints. */
  detail: string;
};

/**
 * A hard fact we could not check, on a pair that is otherwise allowed.
 *
 * Not a violation and not a warning to sit in a log: A4 reads these, prefers
 * pairs that have none, and attaches the "call ahead" note to the user when it
 * proposes one that has some.
 */
export type UnverifiedFact =
  { kind: "opening_hours" } | { kind: "dietary"; tag: string };

export type PairCheck = {
  candidatePlaceId: string;
  slot: TimeSlot;
  violations: ConstraintViolation[];
  unverified: UnverifiedFact[];
};

/** Thrown by the post-check. Carries the findings, so a caller can log them. */
export class HardConstraintError extends Error {
  readonly violations: ConstraintViolation[];

  constructor(violations: ConstraintViolation[]) {
    super(
      `hard constraint violated: ${violations.map((v) => v.detail).join("; ")}`
    );
    this.name = "HardConstraintError";
    this.violations = violations;
  }
}

/* -------------------------------------------------------------------------
 * The rules
 * ---------------------------------------------------------------------- */

const MOBILITY_MODES: MobilityMode[] = ["car", "transit", "walk"];

/**
 * Which modes this person still has at this hour.
 *
 * Precedence is spec §5.7's: the meeting amendment outranks the recurring
 * rules in the profile, which outrank the default of "everything works". So
 * the profile's rules are applied first and the amendment's windows last.
 */
export function availableModes(
  participant: Participant,
  slot: TimeSlot
): Set<MobilityMode> {
  const modes = new Set(MOBILITY_MODES);

  for (const rule of participant.profile.recurringMobilityRules) {
    if (rule.kind !== "mode_unavailable") continue;
    const window: LocalWindow = rule.window
      ? { ...rule.window, weekdays: rule.weekdays }
      : { weekdays: rule.weekdays, from: "00:00", to: "00:00" };
    if (slotOverlapsWindow(slot, window)) modes.delete(rule.mode);
  }

  for (const window of participant.context?.mobilityWindows ?? []) {
    if (!slotOverlapsWindow(slot, window.window)) continue;
    if (window.available) modes.add(window.mode);
    else modes.delete(window.mode);
  }

  return modes;
}

/**
 * How far each way of travelling puts within reach, in kilometres.
 * `null` is no cap at all — the person's own tolerance is the only limit.
 *
 * On foot is **about a kilometre**. Transit and a car are uncapped: a bus
 * network reaches across a city, and a car reaches further than anyone's
 * stated tolerance, so neither adds a limit the profile has not already set.
 *
 * Numbers to tune, not a design — the same footing as the four-hour conflict
 * rule (spec §5.7) and the three-hour minimum meeting length. Agreed on
 * [#89](https://github.com/ron14y-sys/squad_lock/issues/89).
 */
export const REACH_BY_MODE: Readonly<Record<MobilityMode, Kilometres | null>> =
  Object.freeze({ car: null, transit: null, walk: 1 });

/**
 * The furthest this person could get at this hour, whatever their profile
 * says. `null` when nothing caps them.
 *
 * **Why this is not a property of the venue.** The eval set used to mark a
 * venue `reachableWithoutCar: false`, which is not a real thing — no
 * restaurant is car-only, some *people* are car-less. Reachability belongs to
 * the journey, so it belongs to the traveller and the hour, and what it
 * changes is how far they can go, not which places exist (#89).
 *
 * This is the continuous half of spec §5.4's mobility rule. The binary half
 * is already here: no mode at all is an `immobile` violation and the pair is
 * dropped. Losing *some* modes is not a wall, it is a smaller denominator.
 *
 * **B6 or B7c compose this into a `SlotTolerance`** —
 * `min(profile.toleranceKm, cap ?? Infinity)` — and it must be one of them
 * rather than A12: the Context Resolver ships dark and falls back to the
 * baseline on any failure (spec §4.3), so a Resolver-only implementation
 * would hand a car-sized tolerance back to someone who cannot drive every
 * time it was off. The Resolver may still widen on top; it may not be the
 * only source.
 */
export function reachCapKm(
  participant: Participant,
  slot: TimeSlot
): Kilometres | null {
  let cap: Kilometres | null = null;

  for (const mode of availableModes(participant, slot)) {
    const reach = REACH_BY_MODE[mode];
    // One uncapped mode is enough — you take the bus, not the walk.
    if (reach === null) return null;
    if (cap === null || reach > cap) cap = reach;
  }

  // No modes at all is `immobile`, which drops the pair outright. Returning
  // 0 here would instead make every burden infinite, which is the same
  // answer said badly.
  return cap;
}

/**
 * What the venue itself rules out, which is opening hours and nothing else.
 * Everything person-shaped lives in `participantViolations`.
 */
function venueViolations(
  candidate: Candidate,
  slot: TimeSlot
): { violations: ConstraintViolation[]; unverified: UnverifiedFact[] } {
  const hours = candidate.openingHours;

  // Undecided whether we fetch hours at all, so absent means unknown — not
  // "open around the clock" and not "drop it". An empty list is the same
  // thing: a venue Places had no hours for, not a venue that never opens.
  // Permanently shut is `businessStatus`, a different field, dropped at B7.
  if (hours === undefined || hours.length === 0) {
    return { violations: [], unverified: [{ kind: "opening_hours" }] };
  }

  if (windowsCoverSlot(hours, slot)) {
    return { violations: [], unverified: [] };
  }

  return {
    violations: [
      {
        kind: "closed",
        candidatePlaceId: candidate.placeId,
        detail: `${candidate.name} is not open for the whole of ${describeSlot(slot)}`,
      },
    ],
    unverified: [],
  };
}

/**
 * One person against one pair: their unavailable hours, their calendar, whether
 * they can travel at all, and their dietary and allergy tags.
 *
 * A tag the venue neither satisfies nor refuses comes back as `unverified`
 * rather than as a violation — the A2 rule that unknown is not a violation.
 */
function participantViolations(
  candidate: Candidate,
  slot: TimeSlot,
  participant: Participant,
  facts: VenueDietaryFacts | undefined
): { violations: ConstraintViolation[]; unverified: UnverifiedFact[] } {
  const violations: ConstraintViolation[] = [];
  const unverified: UnverifiedFact[] = [];
  const { hardConstraints } = participant.profile;

  const at = (detail: string, kind: ViolationKind) =>
    violations.push({
      kind,
      candidatePlaceId: candidate.placeId,
      participantId: participant.userId,
      detail,
    });

  for (const window of hardConstraints.unavailable) {
    if (slotOverlapsWindow(slot, window)) {
      at(
        `${participant.name} is unavailable ${window.from}–${window.to}, which ${describeSlot(slot)} runs into`,
        "unavailable"
      );
      break;
    }
  }

  for (const busy of participant.busy) {
    if (slotsOverlap(slot, busy)) {
      at(
        `${participant.name} has a calendar block over ${describeSlot(slot)}`,
        "busy"
      );
      break;
    }
  }

  if (availableModes(participant, slot).size === 0) {
    at(
      `${participant.name} has no way of travelling at ${describeSlot(slot)}`,
      "immobile"
    );
  }

  const satisfied = new Set((facts?.satisfies ?? []).map(normaliseTag));
  const refused = new Set((facts?.violates ?? []).map(normaliseTag));

  const dietary: [string[], ViolationKind][] = [
    [hardConstraints.dietary, "dietary"],
    [hardConstraints.allergies, "allergy"],
  ];

  for (const [tags, kind] of dietary) {
    for (const raw of tags) {
      const tag = normaliseTag(raw);
      if (refused.has(tag)) {
        at(
          `${candidate.name} does not meet ${participant.name}'s "${raw}"`,
          kind
        );
      } else if (!satisfied.has(tag)) {
        unverified.push({ kind: "dietary", tag });
      }
    }
  }

  return { violations, unverified };
}

/**
 * A slot as a person reads it, in `APP_TIME_ZONE`. These strings end up in a
 * violation's `detail`, which is what a failing test prints and what the
 * timeline shows — a UTC instant there is unreadable to everyone involved.
 */
const SLOT_START = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIME_ZONE,
  weekday: "short",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const SLOT_END = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "Mon 07 Sep, 19:00–21:00" — the two formatters above, joined. */
function describeSlot(slot: TimeSlot): string {
  return `${SLOT_START.format(slot.start)}–${SLOT_END.format(slot.end)}`;
}

/** Same tag from six participants is one thing to verify, not six. */
function dedupeUnverified(facts: UnverifiedFact[]): UnverifiedFact[] {
  const seen = new Set<string>();
  return facts.filter((fact) => {
    const key = fact.kind === "dietary" ? `dietary:${fact.tag}` : fact.kind;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Every hard constraint, tested against one pair. The single place the rules
 * live — both the filter and the post-check call it, so they cannot drift.
 */
export function checkPair(
  candidate: Candidate,
  slot: TimeSlot,
  participants: Participant[],
  facts?: VenueDietaryFacts
): PairCheck {
  const venue = venueViolations(candidate, slot);
  const violations = [...venue.violations];
  const unverified = [...venue.unverified];

  for (const participant of participants) {
    const found = participantViolations(candidate, slot, participant, facts);
    violations.push(...found.violations);
    unverified.push(...found.unverified);
  }

  return {
    candidatePlaceId: candidate.placeId,
    slot,
    violations,
    unverified: dedupeUnverified(unverified),
  };
}

/* -------------------------------------------------------------------------
 * The filter — runs before the agent
 * ---------------------------------------------------------------------- */

export type ConstraintInput = {
  candidates: Candidate[];
  /** Confirmed participants. One person's hard constraint kills the pair. */
  participants: Participant[];
  /** The slots the group could actually meet in — B6 produces these. */
  slots: TimeSlot[];
  /** What is known about each venue's dietary suitability, by `placeId`. */
  venueFacts?: Record<string, VenueDietaryFacts>;
};

export type ViablePair = {
  candidatePlaceId: string;
  slot: TimeSlot;
  /** Empty means fully verified. A4 prefers these (§13.7 decision). */
  unverified: UnverifiedFact[];
};

export type FilterResult = {
  viable: ViablePair[];
  /**
   * Everything dropped, with its reason. Kept rather than discarded because a
   * run is persisted in full (spec §4.1d) and because "nothing survived" has
   * to be explainable as `stuck` rather than as an empty list.
   */
  dropped: PairCheck[];
};

/**
 * Drops every `(venue, slot)` pair that breaks anyone's hard constraint.
 *
 * This is the enforcement point for spec §4.1b. What comes out is the set of
 * pairs the agent is allowed to choose between; what it does with them, and
 * which it prefers, is A4's business.
 */
export function filterPairs(input: ConstraintInput): FilterResult {
  const viable: ViablePair[] = [];
  const dropped: PairCheck[] = [];

  for (const candidate of input.candidates) {
    const facts = input.venueFacts?.[candidate.placeId];
    for (const slot of input.slots) {
      const check = checkPair(candidate, slot, input.participants, facts);
      if (check.violations.length > 0) {
        dropped.push(check);
      } else {
        viable.push({
          candidatePlaceId: check.candidatePlaceId,
          slot: check.slot,
          unverified: check.unverified,
        });
      }
    }
  }

  return { viable, dropped };
}

/** The viable slots per venue, in the shape `ShortlistEntry` wants (B7c). */
export function viableSlotsByCandidate(
  result: FilterResult
): Map<string, TimeSlot[]> {
  const slots = new Map<string, TimeSlot[]>();
  for (const pair of result.viable) {
    const existing = slots.get(pair.candidatePlaceId);
    if (existing) existing.push(pair.slot);
    else slots.set(pair.candidatePlaceId, [pair.slot]);
  }
  return slots;
}

/* -------------------------------------------------------------------------
 * The post-check — runs after the agent
 * ---------------------------------------------------------------------- */

export type ChosenPair = {
  candidatePlaceId: string;
  slot: TimeSlot;
};

/**
 * Re-tests what the agent chose against the same rules, plus the two things
 * only an answer can get wrong: a venue that was never in the pool, and a
 * slot that was never offered.
 *
 * Returns the findings rather than throwing, for a caller that wants to log
 * them. A4 should call `assertChosenPairAllowed` instead.
 */
export function checkChosenPair(
  chosen: ChosenPair,
  input: ConstraintInput
): ConstraintViolation[] {
  const candidate = input.candidates.find(
    (c) => c.placeId === chosen.candidatePlaceId
  );

  if (!candidate) {
    return [
      {
        kind: "not_a_candidate",
        candidatePlaceId: chosen.candidatePlaceId,
        detail: `"${chosen.candidatePlaceId}" was not in the shortlist the agent was given`,
      },
    ];
  }

  const offered = input.slots.some(
    (slot) =>
      slot.start.getTime() === chosen.slot.start.getTime() &&
      slot.end.getTime() === chosen.slot.end.getTime()
  );

  if (!offered) {
    return [
      {
        kind: "slot_not_offered",
        candidatePlaceId: chosen.candidatePlaceId,
        detail: `${describeSlot(chosen.slot)} was not one of the slots offered`,
      },
    ];
  }

  return checkPair(
    candidate,
    chosen.slot,
    input.participants,
    input.venueFacts?.[candidate.placeId]
  ).violations;
}

/**
 * The post-check as A4 calls it: throws unless the agent's answer is clean.
 *
 * Throwing is the default on purpose. A1 shipped a guard nobody called, and
 * the lesson of #71 is the same one — a check whose result can be ignored is
 * a comment. The answer to a violation here is a failed run, never a proposal
 * sent to somebody who cannot eat there.
 */
export function assertChosenPairAllowed(
  chosen: ChosenPair,
  input: ConstraintInput
): void {
  const violations = checkChosenPair(chosen, input);
  if (violations.length > 0) throw new HardConstraintError(violations);
}

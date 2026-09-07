/**
 * A scenario file, as the engine's types.
 *
 * Written for [A4](../tasks/todo.md)'s "runs end to end on one eval scenario"
 * line, and placed here rather than inside a test because
 * **[A5](../tasks/todo.md) is its real owner**: the eval runner reads every
 * file in `scenarios/`, and it needs exactly this translation. Growing this
 * file is A5's job; A4 only needed enough of it to run one scenario for real.
 *
 * ## What this does, and what it deliberately does not
 *
 * A scenario is written for a person to check by hand, so it says things in a
 * friendlier way than the engine does. `evals/README.md` has the full table of
 * what is a *spelling* (fixed here) against what would be *wrong* (fixed in the
 * file). This adapter only ever performs spellings.
 *
 * **It does not trim a slot to a venue's opening hours.** That is
 * [B6](../tasks/todo.md)'s job — "free slots common to all confirmed
 * participants, intersected with venue opening hours and mobility windows" —
 * and B6 does not exist yet. So the slot this produces is the group's whole
 * free window, and A2 then drops any pair the venue cannot cover for its
 * entirety.
 *
 * That is correct for a scenario where nothing narrows the window, and it is
 * **not enough** for one where something does. In `02` the venue is shut for
 * the whole evening and dropping the pair is the right answer; in `03` and
 * `05` the meeting is supposed to *shorten* rather than disappear, and without
 * B6 those two lose a pair they should keep.
 *
 * **A5 cannot report a fair pass rate until B6 lands**, and this is the
 * reason. `scenariosNeedingTrim` names the affected files so the gap is a
 * value in the code rather than a paragraph somebody has to remember.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ALL_WEEKDAYS, filterPairs } from "@/lib/matching/constraints";
import type { VenueDietaryFacts } from "@/lib/matching/constraints";
import { rankViable } from "@/lib/matching/distance";
import type { MatchAgentInput } from "@/lib/matching/agent";
import { APP_TIME_ZONE } from "@/lib/types";
import type {
  Candidate,
  LatLng,
  LocalWeekday,
  LocalWindow,
  MobilityWindow,
  Participant,
  PreferenceProfile,
  SoftPreferences,
  TimeSlot,
  VenueSoftFacts,
} from "@/lib/types";

/* -------------------------------------------------------------------------
 * The file
 * ---------------------------------------------------------------------- */

export type Scenario = {
  id: string;
  trap: string;
  description: string;
  participants: {
    name: string;
    neighborhood?: string;
    coordinates: LatLng;
    hardConstraints: string[];
    toleranceKm: number;
    mobilityWindows?: MobilityWindow[];
    softPreferences?: SoftPreferences;
  }[];
  candidateVenues: {
    placeId: string;
    name: string;
    neighborhood?: string;
    coordinates: LatLng;
    dietary?: VenueDietaryFacts;
    soft?: VenueSoftFacts;
    openingHours: Record<string, string[]>;
    rating?: number;
  }[];
  availability: { day: string; date: string; start: string; end: string }[];
  expected: {
    venue: string;
    time?: { start: string; end: string };
    reasoning: string;
  };
  initialProposal?: { venue: string };
  rejection?: { by: string; text: string };
  expectedConstraint?: {
    participant: string;
    softPreferences: SoftPreferences;
  };
};

const SCENARIO_DIR = join(__dirname, "scenarios");

function scenarioFiles(): string[] {
  return readdirSync(SCENARIO_DIR)
    .filter((file) => file.endsWith(".json"))
    .sort();
}

/**
 * Every scenario, read once.
 *
 * Memoised because `loadScenario` is otherwise O(every file) per lookup, and
 * A5 loops over ids: eight lookups would mean eight directory scans and 64
 * file reads to obtain eight objects. The fixtures do not change while a
 * process runs.
 */
let cache: Scenario[] | null = null;

export function loadScenarios(): Scenario[] {
  cache ??= scenarioFiles().map(
    (file) =>
      JSON.parse(readFileSync(join(SCENARIO_DIR, file), "utf8")) as Scenario
  );
  return cache;
}

export function loadScenario(id: string): Scenario {
  const found = loadScenarios().find((scenario) => scenario.id === id);
  if (!found) throw new Error(`no eval scenario with id "${id}"`);
  return found;
}

/**
 * Whether this scenario's answer needs B6's trimming to be reachable.
 *
 * **Derived, not listed.** The first version of this was a hardcoded array of
 * two ids, and it was already wrong when it was written: `07` is a third case
 * — Quiet Corner shuts at 00:00 while the group is free until 01:00, so
 * `windowsCoverSlot` drops the expected answer entirely. The suite stayed
 * green because a *different* venue survived, which is the expensive kind of
 * wrong: an eval that quietly reports a missing stage as a model failure.
 *
 * `evals/README.md` already fixed the rule this reads: `expected.time` is
 * required exactly when something narrows the group's window. So a scenario
 * needs trimming when it states an answer window that is not simply the whole
 * window the group was free for. Adding scenario 09 needs no edit here.
 */
export function needsTrim(scenario: Scenario): boolean {
  const answer = scenario.expected.time;
  if (!answer) return false;

  return !scenario.availability.some(
    (window) => window.start === answer.start && window.end === answer.end
  );
}

/* -------------------------------------------------------------------------
 * Wall clock to instants
 * ---------------------------------------------------------------------- */

const LOCAL_CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * A wall-clock time in `APP_TIME_ZONE` as the instant a `TimeSlot` needs.
 *
 * Guessed as UTC and corrected by the zone's offset at that guess, which is
 * exact everywhere except inside a DST transition — and the check at the end
 * catches that rather than letting an hour go quietly missing.
 *
 * This is the fourth edge named in
 * [`lib/types/primitives.ts`](../lib/types/primitives.ts)'s time rule: a human
 * wrote "20:00" in a fixture and meant it in Tel Aviv.
 *
 * `__tests__/eval-scenarios.test.ts` imports this rather than keeping the copy
 * it used to have. It is the only correct wall-clock→instant conversion in the
 * repo, and `initiateMeeting` defers `Meeting.currentDatetime` precisely
 * because it needs one — so if a `lib/` caller ever appears, this function
 * moves to `lib/` rather than being written a second time.
 */
export function instantOf(date: string, time: string, addDays = 0): Date {
  const guess = new Date(`${date}T${time}:00Z`);
  guess.setUTCDate(guess.getUTCDate() + addDays);

  const local = new Date(
    new Date(guess).toLocaleString("en-US", { timeZone: APP_TIME_ZONE })
  );
  const utc = new Date(
    new Date(guess).toLocaleString("en-US", { timeZone: "UTC" })
  );
  const instant = new Date(guess.getTime() - (local.getTime() - utc.getTime()));

  if (LOCAL_CLOCK.format(instant) !== time) {
    throw new Error(
      `${date} ${time} does not exist in ${APP_TIME_ZONE} — a DST transition?`
    );
  }
  return instant;
}

/* -------------------------------------------------------------------------
 * The spellings
 * ---------------------------------------------------------------------- */

function weekdayOf(name: string): LocalWeekday {
  const found = ALL_WEEKDAYS.find((day) => day === name.trim().toLowerCase());
  if (!found) throw new Error(`"${name}" is not a weekday`);
  return found;
}

/**
 * `{ "Thursday": ["18:00-01:00"] }` as `LocalWindow[]`, which is the shape
 * Places actually returns once B7 normalises it.
 */
export function openingWindows(hours: Record<string, string[]>): LocalWindow[] {
  return Object.entries(hours).flatMap(([day, spans]) =>
    spans.map((span) => {
      const [from, to] = span.split("-").map((part) => part.trim());
      if (!from || !to) {
        throw new Error(`"${span}" is not an "HH:MM-HH:MM" span`);
      }
      return { weekdays: [weekdayOf(day)], from, to };
    })
  );
}

/**
 * Every hard-constraint tag a scenario states goes in `dietary`.
 *
 * The two that exist today — `kosher` and `vegan-option-required` — are both
 * dietary, and A2 treats the two buckets identically apart from the `kind` on
 * the violation it reports. **The first scenario with a real allergy needs a
 * rule here**, and should get one rather than a guess: which bucket a tag
 * belongs in is the adapter's business (`evals/README.md`), and nothing in the
 * fixture format says it.
 */
function hardConstraintsOf(tags: string[]) {
  return { dietary: [...tags], allergies: [], unavailable: [] };
}

function participantsOf(scenario: Scenario): Participant[] {
  return scenario.participants.map((person) => {
    const profile: PreferenceProfile = {
      id: `profile-${person.name}`,
      userId: person.name,
      hardConstraints: hardConstraintsOf(person.hardConstraints),
      // Absent stays absent. An empty object is "stated nothing", which is a
      // real state and not a neutral preference (#86).
      softPreferences: person.softPreferences ?? {},
      home: person.coordinates,
      homeNeighbourhood: person.neighborhood ?? null,
      toleranceKm: person.toleranceKm,
      recurringMobilityRules: [],
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };

    return {
      // The name is the id, so a failing assertion reads as a sentence about
      // a person rather than about a cuid.
      userId: person.name,
      name: person.name,
      profile,
      // A scenario's mobility windows are about *this evening*, so they belong
      // on the per-meeting context, which is what outranks the profile's
      // recurring rules (spec §5.7, A2 `availableModes`).
      context: person.mobilityWindows
        ? {
            id: `context-${person.name}`,
            meetingId: scenario.id,
            userId: person.name,
            origin: null,
            originLabel: null,
            mobilityWindows: person.mobilityWindows,
            // A scenario's mobility windows say nothing about preferences.
            // `null` is "no correction", which is not the same as `{}`.
            softPreferences: null,
            note: null,
            createdAt: new Date(0),
            updatedAt: new Date(0),
          }
        : null,
      origin: person.coordinates,
      // No scenario carries a calendar: availability is stated directly as the
      // window the group is already free in.
      busy: [],
    };
  });
}

function candidatesOf(scenario: Scenario): Candidate[] {
  return scenario.candidateVenues.map((venue) => ({
    placeId: venue.placeId,
    name: venue.name,
    address: null,
    location: venue.coordinates,
    neighbourhood: venue.neighborhood ?? null,
    ...(venue.rating === undefined ? {} : { rating: venue.rating }),
    openingHours: openingWindows(venue.openingHours),
  }));
}

/** The group's free windows. Not yet trimmed to any venue — see the header. */
function slotsOf(scenario: Scenario): TimeSlot[] {
  return scenario.availability.map((window) => ({
    start: instantOf(window.date, window.start),
    // "00:00" or anything at or before the start is the following midnight.
    end: instantOf(window.date, window.end, window.end <= window.start ? 1 : 0),
  }));
}

/** Both kinds of venue fact travel beside a candidate, keyed by `placeId`. */
function venueFactsOf(scenario: Scenario): Record<string, VenueDietaryFacts> {
  return Object.fromEntries(
    scenario.candidateVenues
      .filter((venue) => venue.dietary)
      .map((venue) => [venue.placeId, venue.dietary as VenueDietaryFacts])
  );
}

function venueSoftFactsOf(scenario: Scenario): Record<string, VenueSoftFacts> {
  return Object.fromEntries(
    scenario.candidateVenues
      .filter((venue) => venue.soft)
      .map((venue) => [venue.placeId, venue.soft as VenueSoftFacts])
  );
}

/* -------------------------------------------------------------------------
 * The whole thing
 * ---------------------------------------------------------------------- */

/**
 * A scenario as one matching run's input: A2's filter and A3's ranking applied
 * exactly as the real pipeline applies them.
 *
 * Running the real stages rather than hand-writing their output is the point.
 * A fixture that states which pairs are viable can drift from what the filter
 * really produces — which is the shape of mistake #86 was.
 */
export function scenarioAgentInput(
  scenario: Scenario,
  overrides: Partial<MatchAgentInput> = {}
): MatchAgentInput {
  const participants = participantsOf(scenario);
  const candidates = candidatesOf(scenario);
  const slots = slotsOf(scenario);
  const venueFacts = venueFactsOf(scenario);

  const filtered = filterPairs({ candidates, participants, slots, venueFacts });

  return {
    meetingId: `eval-${scenario.id}`,
    cycleNumber: 1,
    occasion: scenario.description,
    participants,
    candidates,
    viable: filtered.viable,
    ranked: rankViable(filtered, candidates, participants),
    venueFacts,
    venueSoftFacts: venueSoftFactsOf(scenario),
    ...overrides,
  };
}

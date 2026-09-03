import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { windowsCoverSlot } from "@/lib/matching/constraints";
import {
  burdenValue,
  compareLeximin,
  straightLineKm,
} from "@/lib/matching/distance";
import { APP_TIME_ZONE } from "@/lib/types";
import type { LatLng, LocalWindow, TimeSlot } from "@/lib/types";

/**
 * Guards issue #86: two eval scenarios whose written distances did not match
 * their own coordinates.
 *
 * Both were estimated by hand, and both estimates were *road* distances —
 * 06 said "~13 km" where the straight line is 10.45, and 04 said one venue
 * was nearest a participant when it was in fact the farther of the two. That
 * inverted 06's expected answer and left 04's trap unable to catch anything,
 * and nothing failed, because no code read these files yet.
 *
 * The eval runner that will read them is A5, and it does not exist. So the
 * arithmetic these scenarios claim is pinned here instead, against the same
 * `lib/matching/distance` the runner will eventually use. A scenario whose
 * prose drifts from its coordinates again fails on the next `npm test`
 * rather than on somebody's pass-rate report months later.
 *
 * ⚠️ These are straight-line distances with a detour correction, never a
 * routed journey. Nothing here computes driving or travel time (spec §5.4).
 */

type Scenario = {
  id: string;
  trap: string;
  participants: {
    name: string;
    coordinates: LatLng;
    hardConstraints: string[];
    toleranceKm: number;
  }[];
  candidateVenues: {
    /** Not a real Places id — readable, so a failing assertion names a venue. */
    placeId: string;
    name: string;
    coordinates: LatLng;
    /** The engine's three states. A tag in neither is "not known" (A2). */
    dietary?: { satisfies?: string[]; violates?: string[] };
    /** Weekday name to `"HH:MM-HH:MM"` spans, as Places reports them. */
    openingHours: Record<string, string[]>;
    rating?: number;
  }[];
  availability: {
    day: string;
    /** `YYYY-MM-DD`, so a `TimeSlot` can be built. 07 crosses midnight. */
    date: string;
    start: string;
    end: string;
  }[];
  expected: {
    venue: string;
    /**
     * Required for mobility-window scenarios and wherever the venue's hours
     * trim the group's window — see `evals/README.md`.
     */
    time?: { start: string; end: string };
    reasoning: string;
  };
};

const dir = join(__dirname, "..", "evals", "scenarios");

const files = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort();

const load = (file: string) =>
  JSON.parse(readFileSync(join(dir, file), "utf8")) as Scenario;

const scenarios = files.map(load);

const byId = (id: string) => {
  const found = scenarios.find((s) => s.id === id);
  if (!found) throw new Error(`no eval scenario with id "${id}"`);
  return found;
};

/**
 * One candidate's leximin vector over a scenario, worst-first.
 *
 * `detour` names a factor per participant, defaulting to 1.0 — the naive
 * straight-line reading, which is what a run with the Context Resolver off
 * produces (spec §4.3).
 */
const vectorFor = (
  scenario: Scenario,
  venueName: string,
  detour: Record<string, number> = {}
) => {
  const venue = scenario.candidateVenues.find((v) => v.name === venueName);
  if (!venue) throw new Error(`no venue "${venueName}" in ${scenario.id}`);
  const at = venue.coordinates;

  return scenario.participants
    .map((p) =>
      burdenValue(
        straightLineKm(p.coordinates, at),
        detour[`${p.name}|${venueName}`] ?? 1,
        p.toleranceKm
      )
    )
    .sort((a, b) => b - a);
};

const leximinWinner = (
  scenario: Scenario,
  detour: Record<string, number> = {}
) =>
  [...scenario.candidateVenues].sort((a, b) =>
    compareLeximin(
      vectorFor(scenario, a.name, detour),
      vectorFor(scenario, b.name, detour)
    )
  )[0]!.name;

const round = (v: number[]) => v.map((x) => Number(x.toFixed(3)));

describe("every eval scenario", () => {
  it("has at least one file to check, so a moved folder fails loudly", () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it.each(scenarios.map((s) => [s.id, s] as const))(
    "%s puts every participant and venue at a real point on Earth",
    (_id, scenario) => {
      // `straightLineKm` throws on a coordinate that is not a point on Earth,
      // rather than returning NaN — a NaN burden would not fail, it would
      // silently randomise a ranking.
      for (const p of scenario.participants) {
        for (const v of scenario.candidateVenues) {
          const at = v.coordinates;
          expect(() => straightLineKm(p.coordinates, at)).not.toThrow();
        }
      }
    }
  );

  it.each(scenarios.map((s) => [s.id, s] as const))(
    "%s gives every participant a usable tolerance",
    (_id, scenario) => {
      // Zero is not how a scenario says "immobile" — that is a mobility
      // window, and A2's `immobile` violation. Here it is just a broken
      // denominator.
      for (const p of scenario.participants) {
        expect(p.toleranceKm).toBeGreaterThan(0);
      }
    }
  );
});

describe("06 — no perfect solution, dispersed group", () => {
  const scenario = byId("no-perfect-solution-dispersed-group");

  it("agrees with the leximin its own coordinates produce", () => {
    // The bug: `expected.venue` was Herbert Samuel, computed from road
    // distances of ~13 km and ~9 km. The straight lines are 10.45 and 5.77,
    // and they invert the answer.
    expect(leximinWinner(scenario)).toBe(scenario.expected.venue);
  });

  it("still leaves someone over their tolerance whichever venue wins", () => {
    // The scenario's premise, independent of which venue the answer is.
    for (const venue of scenario.candidateVenues) {
      expect(vectorFor(scenario, venue.name)[0]).toBeGreaterThan(1);
    }
  });

  it("prefers the lower-rated venue, because there is no rate between kilometres and stars", () => {
    // Herbert Samuel is rated 4.3 and Kfar Bat Yam 3.6. Leximin does not
    // weigh them against each other at all (spec §5.4).
    expect(round(vectorFor(scenario, "Kfar Bat Yam Midpoint Grill"))).toEqual([
      1.154, 1.154, 0.778,
    ]);
    expect(round(vectorFor(scenario, "Herbert Samuel Grill"))).toEqual([
      1.307, 0.006, 0.006,
    ]);
  });
});

describe("04 — the semantic geography trap", () => {
  const scenario = byId("semantic-geography-trap");

  it("is caught out by straight-line distance alone, which is the point of it", () => {
    // The bug: Rothschild 12 was the nearer of the two venues to Gili, so
    // naive leximin already picked the expected answer and the trap measured
    // nothing. It must pick the *wrong* venue with no detour factor applied.
    expect(leximinWinner(scenario)).not.toBe(scenario.expected.venue);
    expect(leximinWinner(scenario)).toBe("Shapira Social");
  });

  it("reaches the expected answer once the barrier is priced in", () => {
    // A detour factor is keyed by region *pair* (`DetourFactor`), so it lands
    // on one (participant, venue) cell and not on the participant — a factor
    // applied to Gili everywhere would penalise both venues and flip nothing.
    // These two stand in for what A12 would resolve: the Ayalon and the
    // railway between Shapira and Ramat Gan, against a continuous arterial
    // from Ramat Gan to Rothschild.
    const winner = leximinWinner(scenario, {
      "Gili|Shapira Social": 1.7,
      "Gili|Rothschild 12": 1.25,
    });

    expect(winner).toBe(scenario.expected.venue);
  });

  it("turns on the detour factor existing at all, not on its exact value", () => {
    // 4.247 / 3.988 — a 7% gap between the two factors is enough to flip it,
    // so the scenario does not quietly depend on the Resolver returning one
    // particular number.
    const gili = scenario.participants.find((p) => p.name === "Gili")!;
    const km = (name: string) => {
      const at = scenario.candidateVenues.find(
        (v) => v.name === name
      )?.coordinates;
      if (!at) throw new Error(`no venue "${name}" with coordinates`);
      return straightLineKm(gili.coordinates, at);
    };

    expect(km("Rothschild 12") / km("Shapira Social")).toBeLessThan(1.1);
    expect(km("Rothschild 12") / km("Shapira Social")).toBeGreaterThan(1);
  });
});

/* -------------------------------------------------------------------------
 * The meeting shortens to fit the venue
 *
 * A venue need not be open for the whole window the group is free: the slot
 * is the intersection, and only an empty one drops the pair. B6 owns the real
 * intersection (`tasks/todo.md`) and does not exist yet, so the small local
 * one below stands in — it is deliberately not exported and not in
 * `lib/matching/`, because a second implementation for B-track to reconcile
 * with is worse than none.
 *
 * Note this is the step *before* `windowsCoverSlot`, which demands the whole
 * slot sit inside a single opening window. That rule is right and unchanged;
 * it stops a slot spanning the gap between lunch and dinner service.
 * ---------------------------------------------------------------------- */

const MINUTES_PER_DAY = 24 * 60;

/** `"20:30"` to 1230. Throws rather than guessing — a malformed fixture is a bug. */
const minutes = (time: string) => {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time.trim());
  if (!match) throw new Error(`"${time}" is not an HH:MM wall-clock time`);
  return Number(match[1]) * 60 + Number(match[2]);
};

const clock = (m: number) => {
  const wrapped = ((m % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`;
};

/** An end at or before its start is how "21:00 to 01:00" is written down. */
const span = (from: string, to: string) => {
  const start = minutes(from);
  const end = minutes(to);
  return { start, end: end <= start ? end + MINUTES_PER_DAY : end };
};

type Trim = { start: string; end: string; minutes: number } | null;

/**
 * The group's window narrowed to one venue's hours on that day.
 *
 * Intersected against each opening window separately and the longest kept,
 * never against their union — the same reason `windowsCoverSlot` tests
 * containment in a single window.
 */
const trim = (scenario: Scenario, venueName: string): Trim => {
  const free = scenario.availability[0]!;
  const venue = scenario.candidateVenues.find((v) => v.name === venueName);
  if (!venue) throw new Error(`no venue "${venueName}" in ${scenario.id}`);

  const window = span(free.start, free.end);
  let best: Trim = null;

  for (const hours of venue.openingHours[free.day] ?? []) {
    const [from, to] = hours.split("-");
    if (!from || !to) throw new Error(`"${hours}" is not an HH:MM-HH:MM span`);
    const open = span(from, to);

    const start = Math.max(window.start, open.start);
    const end = Math.min(window.end, open.end);
    if (end <= start) continue;
    if (best && best.minutes >= end - start) continue;
    best = { start: clock(start), end: clock(end), minutes: end - start };
  }

  return best;
};

describe("a venue need not be open for the whole evening", () => {
  it.each(scenarios.map((s) => [s.id, s] as const))(
    "%s leaves the expected venue some of the group's window",
    (_id, scenario) => {
      // The rule is that an early closing time *shortens* the meeting. Only
      // an empty intersection drops the pair — 02's trap, asserted below.
      expect(trim(scenario, scenario.expected.venue)).not.toBeNull();
    }
  );

  it.each(scenarios.map((s) => [s.id, s] as const))(
    "%s states the trimmed slot wherever trimming happens",
    (_id, scenario) => {
      const trimmed = trim(scenario, scenario.expected.venue)!;
      const free = scenario.availability[0]!;
      const whole = trimmed.start === free.start && trimmed.end === free.end;
      const stated = scenario.expected.time;

      if (whole) return; // Nothing was trimmed; `expected.time` is optional.

      // Trimming makes the answer a (venue, time) pair rather than a venue,
      // so the scenario has to say which time.
      expect(
        stated,
        `${scenario.id} trims but states no expected.time`
      ).toBeDefined();
      if (typeof stated === "string") return; // 03's old form — stage 2.
      expect(stated).toEqual({ start: trimmed.start, end: trimmed.end });
    }
  );

  it("shortens the evening at 05, rather than ruling the venue out", () => {
    // HaKosem shuts at 22:30 and the group is free until 23:00. Under the
    // old whole-window reading this venue was dropped and the scenario's
    // expected answer was unreachable.
    expect(
      trim(byId("no-perfect-solution-diet-conflict"), "HaKosem Kerem")
    ).toMatchObject({ start: "19:30", end: "22:30" });
  });

  it("shortens the evening at 07, so the rejection loop has a follow-up", () => {
    // Quiet Corner shuts at midnight and the group is free until 01:00. It is
    // the only candidate left after Beer Bazaar is rejected, so dropping it
    // would leave the loop with nothing to propose.
    expect(trim(byId("rejection-loop-noise"), "Quiet Corner")).toMatchObject({
      start: "21:00",
      end: "00:00",
    });
  });

  it("still drops a venue shut for the whole window, which is 02's trap", () => {
    const scenario = byId("closed-on-the-night-trap");

    // Anna Loulou is the better-rated venue and shuts at 20:00; the group is
    // not free until 21:00. An empty intersection is the one case that drops.
    expect(trim(scenario, "Anna Loulou")).toBeNull();
    expect(trim(scenario, scenario.expected.venue)).not.toBeNull();
  });
});

/* -------------------------------------------------------------------------
 * The vocabulary the engine actually uses
 *
 * A scenario is wrong when it says something the engine cannot express, and
 * merely different when it says the same thing in a friendlier way. These
 * assertions cover the first kind. The friendlier spellings that remain — a
 * flat `hardConstraints` array, opening hours keyed by weekday name — are
 * documented as an adapter in `evals/README.md` instead.
 * ---------------------------------------------------------------------- */

/** Agreed with the shortest meeting worth proposing. See `evals/README.md`. */
const MINIMUM_MEETING_MINUTES = 180;

const WEEKDAY = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIME_ZONE,
  weekday: "long",
});

const LOCAL_CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * A wall-clock time in `APP_TIME_ZONE` as the instant a `TimeSlot` needs.
 *
 * Guessed as UTC and then corrected by the zone's offset at that guess, which
 * is exact everywhere except inside a DST transition — and the assertion
 * below catches that rather than letting an hour go quietly missing.
 */
const instantOf = (date: string, time: string, addDays = 0) => {
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
};

/** The trimmed slot as the two instants `windowsCoverSlot` expects. */
const slotOf = (scenario: Scenario, venueName: string): TimeSlot => {
  const free = scenario.availability[0]!;
  const trimmed = trim(scenario, venueName)!;
  const start = instantOf(free.date, trimmed.start);
  // "00:00" as an end means the following midnight, not the one just passed.
  const end = instantOf(
    free.date,
    trimmed.end,
    trimmed.end <= trimmed.start ? 1 : 0
  );
  return { start, end };
};

const openingWindowsOf = (
  scenario: Scenario,
  venueName: string
): LocalWindow[] => {
  const free = scenario.availability[0]!;
  const venue = scenario.candidateVenues.find((v) => v.name === venueName)!;
  return (venue.openingHours[free.day] ?? []).map((hours) => {
    const [from, to] = hours.split("-");
    return {
      weekdays: [free.day.toLowerCase() as LocalWindow["weekdays"][number]],
      from: from!,
      to: to!,
    };
  });
};

describe("the fixtures speak the engine's vocabulary", () => {
  it.each(scenarios.map((s) => [s.id, s] as const))(
    "%s gives every venue an id, and no two the same",
    (_id, scenario) => {
      // `placeId` is the dedupe key, the cache key, A3's leximin tiebreak,
      // and the id inside every `ConstraintViolation`.
      const ids = scenario.candidateVenues.map((v) => v.placeId);
      for (const id of ids) expect(id).toMatch(/^place-\d\d-[a-z0-9-]+$/);
      expect(new Set(ids).size).toBe(ids.length);
    }
  );

  it.each(scenarios.map((s) => [s.id, s] as const))(
    "%s names a date that really is the weekday it claims",
    (_id, scenario) => {
      // `TimeSlot` is instants, so a weekday name alone cannot build one —
      // and 07's window crosses midnight, so the date is not cosmetic.
      for (const free of scenario.availability) {
        expect(WEEKDAY.format(instantOf(free.date, "12:00"))).toBe(free.day);
      }
    }
  );

  it.each(scenarios.map((s) => [s.id, s] as const))(
    "%s leaves the expected venue at least the minimum meeting length",
    (_id, scenario) => {
      expect(
        trim(scenario, scenario.expected.venue)!.minutes
      ).toBeGreaterThanOrEqual(MINIMUM_MEETING_MINUTES);
    }
  );

  it.each(scenarios.map((s) => [s.id, s] as const))(
    "%s never answers with a venue known to break someone's hard constraint",
    (_id, scenario) => {
      // A2 matches tags through `normaliseTag`, which lowercases and trims
      // and maps nothing — so "vegan-option-required" has to be spelled the
      // same on both sides or the constraint silently becomes unverified.
      const venue = scenario.candidateVenues.find(
        (v) => v.name === scenario.expected.venue
      )!;
      const refused = new Set(
        (venue.dietary?.violates ?? []).map((t) => t.trim().toLowerCase())
      );

      for (const p of scenario.participants) {
        for (const tag of p.hardConstraints) {
          expect(refused.has(tag.trim().toLowerCase())).toBe(false);
        }
      }
    }
  );

  it.each(scenarios.map((s) => [s.id, s] as const))(
    "%s builds a slot the real opening-hours check accepts",
    (_id, scenario) => {
      // The round-trip the local `trim` helper is standing in for: once the
      // slot has been narrowed to the venue's hours, A2's whole-slot
      // containment must accept it. If the two ever disagree, this fails.
      const venue = scenario.expected.venue;
      expect(
        windowsCoverSlot(
          openingWindowsOf(scenario, venue),
          slotOf(scenario, venue)
        )
      ).toBe(true);
    }
  );

  it("drops 01's better-rated venue on a dietary fact, not on a boolean", () => {
    const scenario = byId("hard-constraint-trap");
    const toto = scenario.candidateVenues.find((v) => v.name === "Toto")!;

    // `kosher: false` could not say which of A2's three states it meant.
    // "Known to violate" is the one that drops a candidate; "not known"
    // would have left Toto in the pool, marked unverified for A4 to warn on.
    expect(toto.dietary?.violates).toContain("kosher");
    expect(toto.rating).toBeGreaterThan(
      scenario.candidateVenues.find((v) => v.name === scenario.expected.venue)!
        .rating ?? 0
    );
  });
});

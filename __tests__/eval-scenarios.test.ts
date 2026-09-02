import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  burdenValue,
  compareLeximin,
  straightLineKm,
} from "@/lib/matching/distance";
import type { LatLng } from "@/lib/types";

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
    toleranceKm: number;
  }[];
  /**
   * `coordinates` is optional because three scenarios do not carry them:
   * 05, 07 and 08 turn on diet, noise and price, and were written without a
   * geography. A5's runner will need them to score a shortlist at all — see
   * the note in `evals/README.md`.
   */
  candidateVenues: { name: string; coordinates?: LatLng }[];
  expected: { venue: string };
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
  if (!venue?.coordinates) {
    throw new Error(
      `no venue "${venueName}" with coordinates in ${scenario.id}`
    );
  }
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
          if (!v.coordinates) continue;
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

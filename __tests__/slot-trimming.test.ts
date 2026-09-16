import { describe, expect, it } from "vitest";

import {
  instantOf,
  loadScenario,
  loadScenarios,
  needsTrim,
  scenarioAgentInput,
} from "@/evals/adapter";
import { expectedPlaceId } from "@/evals/judge";
import {
  MINIMUM_MEETING_MINUTES,
  meetsMinimumLength,
  trimPairToViableSlots,
  windowsCoverSlot,
} from "@/lib/matching/constraints";
import { originOf, straightLineKm } from "@/lib/matching/distance";
import { APP_TIME_ZONE } from "@/lib/types";
import type { Candidate, Participant, TimeSlot } from "@/lib/types";

/**
 * The meeting shortens to fit the venue.
 *
 * Defined before it was built — `evals/README.md`, B6's acceptance, spec §5.4
 * and #86 all say the same thing — and asserted here against the three eval
 * scenarios whose agreed answers it makes reachable: `03`, `05` and `07`.
 *
 * Every case is pure: no model, no network, no database.
 */

const CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const reads = (slot: TimeSlot) =>
  `${CLOCK.format(slot.start)}–${CLOCK.format(slot.end)}`;

/** One scenario's pieces, as the pipeline would hand them over. */
function pairFrom(scenarioId: string, placeId: string) {
  const scenario = loadScenario(scenarioId);
  const input = scenarioAgentInput(scenario);
  const candidate = input.candidates.find((c) => c.placeId === placeId);
  if (!candidate) throw new Error(`no candidate ${placeId}`);

  const window = scenario.availability[0];
  const slot: TimeSlot = {
    start: instantOf(window.date, window.start),
    end: instantOf(window.date, window.end, window.end <= window.start ? 1 : 0),
  };

  const distanceKm = Object.fromEntries(
    input.participants.map((p) => [
      p.userId,
      straightLineKm(originOf(p), candidate.location),
    ])
  );

  return {
    slot,
    candidate,
    participants: input.participants,
    distanceKm,
    free: `${window.start}–${window.end}`,
  };
}

describe("opening hours shorten the meeting", () => {
  it("05 — HaKosem Kerem shuts at 22:30, so the evening ends at 22:30", () => {
    const pair = pairFrom(
      "no-perfect-solution-diet-conflict",
      "place-05-hakosem-kerem"
    );
    expect(pair.free).toBe("19:30–23:00");

    const slots = trimPairToViableSlots(pair);
    expect(slots.map(reads)).toEqual(["19:30–22:30"]);
  });

  it("07 — Quiet Corner shuts at midnight, so the evening ends at midnight", () => {
    const pair = pairFrom("rejection-loop-noise", "place-07-quiet-corner");
    expect(pair.free).toBe("21:00–01:00");

    const slots = trimPairToViableSlots(pair);
    expect(slots.map(reads)).toEqual(["21:00–00:00"]);
  });

  it("02 — an empty intersection is the one case that drops the pair", () => {
    // Anna Loulou shuts at 20:00; the group is not free until 20:00.
    const pair = pairFrom("closed-on-the-night-trap", "place-02-anna-loulou");
    expect(trimPairToViableSlots(pair)).toEqual([]);
  });

  it("keeps the whole window when the venue is open for all of it", () => {
    const pair = pairFrom("closed-on-the-night-trap", "place-02-port-said");
    expect(trimPairToViableSlots(pair).map(reads)).toEqual(["20:00–23:00"]);
  });

  it("every slot it returns survives windowsCoverSlot, which runs after it", () => {
    for (const [scenario, placeId] of [
      ["no-perfect-solution-diet-conflict", "place-05-hakosem-kerem"],
      ["rejection-loop-noise", "place-07-quiet-corner"],
      ["mobility-window-trap", "place-03-bicicletta"],
    ] as const) {
      const pair = pairFrom(scenario, placeId);
      for (const slot of trimPairToViableSlots(pair)) {
        expect(windowsCoverSlot(pair.candidate.openingHours ?? [], slot)).toBe(
          true
        );
      }
    }
  });
});

describe("reach shortens the meeting too", () => {
  it("03 — Shira has no car and no transit until 20:00, so the evening starts at 20:00", () => {
    const pair = pairFrom("mobility-window-trap", "place-03-bicicletta");
    expect(pair.free).toBe("18:00–23:00");
    // On foot she reaches about a kilometre; Bicicletta is far outside that.
    expect(pair.distanceKm["Shira"]).toBeGreaterThan(5);

    expect(trimPairToViableSlots(pair).map(reads)).toEqual(["20:00–23:00"]);
  });

  it("does not narrow a venue she can walk to", () => {
    // Herzl 16 is next door to Shira, so the walking hours are fine.
    const pair = pairFrom("mobility-window-trap", "place-03-herzl-16");
    expect(pair.distanceKm["Shira"]).toBeLessThan(1);

    expect(trimPairToViableSlots(pair).map(reads)).toEqual(["18:00–23:00"]);
  });

  it("never narrows on tolerance — being far is a burden, not a wall", () => {
    // Scenario 06's agreed answer puts two people over their stated tolerance.
    const pair = pairFrom(
      "no-perfect-solution-dispersed-group",
      "place-06-kfar-bat-yam-midpoint-grill"
    );
    const worst = Math.max(...Object.values(pair.distanceKm));
    expect(worst).toBeGreaterThan(
      Math.min(...pair.participants.map((p) => p.profile.toleranceKm))
    );

    expect(trimPairToViableSlots(pair)).toHaveLength(1);
  });
});

describe("the three-hour minimum", () => {
  const pair = pairFrom(
    "no-perfect-solution-diet-conflict",
    "place-05-hakosem-kerem"
  );

  it("drops a pair narrowed under three hours, and only that pair", () => {
    expect(trimPairToViableSlots({ ...pair, minimumMinutes: 181 })).toEqual([]);
    expect(
      trimPairToViableSlots({ ...pair, minimumMinutes: 180 })
    ).toHaveLength(1);
  });

  it("gates the group's own window with the same number", () => {
    expect(MINIMUM_MEETING_MINUTES).toBe(180);
    expect(meetsMinimumLength(pair.slot)).toBe(true);
    expect(
      meetsMinimumLength({
        start: pair.slot.start,
        end: new Date(pair.slot.start.getTime() + 179 * 60_000),
      })
    ).toBe(false);
  });
});

describe("hours that are not known", () => {
  it("narrow nothing, because absent is unknown and not 'always open'", () => {
    const pair = pairFrom("closed-on-the-night-trap", "place-02-anna-loulou");
    const blind: Candidate = { ...pair.candidate, openingHours: undefined };

    expect(
      trimPairToViableSlots({ ...pair, candidate: blind }).map(reads)
    ).toEqual(["20:00–23:00"]);
  });

  it("a venue open twice in one window offers two evenings, not one", () => {
    const pair = pairFrom("closed-on-the-night-trap", "place-02-port-said");
    const split: Candidate = {
      ...pair.candidate,
      openingHours: [
        { weekdays: ["thursday"], from: "12:00", to: "16:00" },
        { weekdays: ["thursday"], from: "18:00", to: "23:30" },
      ],
    };
    const wide: TimeSlot = {
      start: instantOf("2026-09-10", "12:00"),
      end: instantOf("2026-09-10", "23:00"),
    };
    const participants: Participant[] = pair.participants;

    expect(
      trimPairToViableSlots({
        ...pair,
        candidate: split,
        slot: wide,
        participants,
      })
        .map(reads)
        .sort()
    ).toEqual(["12:00–16:00", "18:00–23:00"]);
  });
});

describe("the adapter now trims, so the pipeline offers the agreed hours", () => {
  /**
   * The end-to-end guard, with no model and no request.
   *
   * `needsTrim` is true for exactly the scenarios whose agreed answer states a
   * window narrower than the one the group was free for. Before the wiring
   * those were unreachable — and in `05` and `07` the agreed venue was
   * filtered out altogether while a *different* one survived and was proposed,
   * which is a missing stage arriving as a confident wrong answer.
   *
   * This asserts the fixture's own `expected` is now on the table: the right
   * venue, at the right hours, among the pairs the agent is offered.
   */
  it("every scenario that needs trimming can now reach its expected pair", () => {
    const trimmed = loadScenarios().filter(needsTrim);
    expect(trimmed.map((s) => s.id)).toEqual([
      "mobility-window-trap",
      "no-perfect-solution-diet-conflict",
      "rejection-loop-noise",
    ]);

    for (const scenario of trimmed) {
      const offered = scenarioAgentInput(scenario).viable.filter(
        (pair) => pair.candidatePlaceId === expectedPlaceId(scenario)
      );

      expect(
        offered.map((pair) => reads(pair.slot)),
        `${scenario.id} must offer ${scenario.expected.venue}`
      ).toContain(
        `${scenario.expected.time!.start}–${scenario.expected.time!.end}`
      );
    }
  });

  it("02 is still dropped, which is what stops trimming meaning 'never drop'", () => {
    const offered = scenarioAgentInput(
      loadScenario("closed-on-the-night-trap")
    ).viable.map((pair) => pair.candidatePlaceId);

    expect(offered).not.toContain("place-02-anna-loulou");
    expect(offered).toContain("place-02-port-said");
  });
});

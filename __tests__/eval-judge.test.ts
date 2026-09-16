import { describe, expect, it } from "vitest";

import { instantOf, loadScenario, loadScenarios } from "@/evals/adapter";
import {
  classify,
  expectedPlaceId,
  judge,
  type Classification,
} from "@/evals/judge";
import type { MatchOptionDraft, MatchRunDraft } from "@/lib/matching/agent";

/**
 * A5's judge, tested without a model.
 *
 * A4 is covered at its guard rails and by one live run; the thing that has
 * never been tested is whether the *right* answer can be told from a legal
 * one. These fabricate drafts rather than calling anything, so the whole file
 * runs on `npm test` with no key and no quota — which is the point, on a tier
 * that allows 20 requests a day.
 */

/** A one-option draft claiming a venue and a wall-clock window. */
function draftOf(
  scenarioId: string,
  placeId: string,
  window?: { date: string; start: string; end: string }
): MatchRunDraft {
  const date = window?.date ?? "2026-09-10";
  const start = window?.start ?? "20:00";
  const end = window?.end ?? "23:00";

  const option: MatchOptionDraft = {
    rank: 1,
    venue: {
      placeId,
      name: placeId,
      address: null,
      location: { lat: 0, lng: 0 },
    },
    proposedDatetime: instantOf(date, start),
    proposedEnd: instantOf(date, end, end <= start ? 1 : 0),
    participantJustifications: {},
    tradeoffs: {},
    unverified: [],
  };

  return {
    meetingId: `eval-${scenarioId}`,
    cycleNumber: 1,
    shortlist: [],
    options: [option],
  } as MatchRunDraft;
}

describe("classify", () => {
  it("reads the fixture rather than a list of ids", () => {
    const actual = Object.fromEntries(
      loadScenarios().map((scenario) => [scenario.id, classify(scenario)])
    ) as Record<string, Classification>;

    // 03 and 05 became scored the moment the adapter started trimming — the
    // rule reads `trap`, so no edit was needed here. 04 stays blocked despite
    // needing no trimming: its own reasoning says a straight-line-only engine
    // is expected to pick the other venue.
    expect(actual).toEqual({
      "hard-constraint-trap": "scored",
      "closed-on-the-night-trap": "scored",
      "mobility-window-trap": "scored",
      "semantic-geography-trap": "blocked",
      "no-perfect-solution-diet-conflict": "scored",
      "no-perfect-solution-dispersed-group": "scored",
      "rejection-loop-noise": "deferred",
      "rejection-loop-budget": "deferred",
    });
  });
});

describe("expectedPlaceId", () => {
  it("resolves every scenario's expected venue to an id", () => {
    for (const scenario of loadScenarios()) {
      expect(expectedPlaceId(scenario)).toMatch(/^place-/);
    }
  });

  it("raises on a name no candidate carries, rather than failing the run", () => {
    const scenario = {
      ...loadScenario("hard-constraint-trap"),
      expected: { venue: "Somewhere Else", reasoning: "" },
    };
    expect(() => expectedPlaceId(scenario)).toThrow(
      /not one of its candidateVenues/
    );
  });
});

describe("judge", () => {
  const venueOnly = loadScenario("hard-constraint-trap");
  const withTime = loadScenario("mobility-window-trap");

  it("passes the agreed venue when no time is stated", () => {
    const verdict = judge(
      venueOnly,
      draftOf(venueOnly.id, "place-01-container")
    );
    expect(verdict.pass).toBe(true);
  });

  it("fails another venue, and names both", () => {
    const verdict = judge(venueOnly, draftOf(venueOnly.id, "place-01-hasalon"));
    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toContain("Container");
  });

  it("fails the right venue at the wrong hour where a time is stated", () => {
    const verdict = judge(
      withTime,
      draftOf(withTime.id, "place-03-bicicletta", {
        date: "2026-09-09",
        start: "18:00",
        end: "23:00",
      })
    );
    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toContain("20:00");
  });

  it("passes the right venue at the stated hour", () => {
    const verdict = judge(
      withTime,
      draftOf(withTime.id, "place-03-bicicletta", {
        date: "2026-09-09",
        start: withTime.expected.time!.start,
        end: withTime.expected.time!.end,
      })
    );
    expect(verdict.pass).toBe(true);
  });

  it("judges rank 1, not whichever option happens to be right", () => {
    const draft = draftOf(venueOnly.id, "place-01-hasalon");
    draft.options.push({
      ...draft.options[0],
      rank: 2,
      venue: { ...draft.options[0].venue, placeId: "place-01-container" },
    });
    expect(judge(venueOnly, draft).pass).toBe(false);
  });
});

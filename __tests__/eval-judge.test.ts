import { describe, expect, it } from "vitest";

import { instantOf, loadScenario, loadScenarios } from "@/evals/adapter";
import {
  blockedReason,
  classify,
  expectedPlaceId,
  judge,
  judgeConstraint,
  type Classification,
} from "@/evals/judge";
import type { MatchOptionDraft, MatchRunDraft } from "@/lib/matching/agent";
import type { ConstraintUpdate } from "@/lib/extraction/constraint-updater";

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
    // is expected to pick the other venue. 08 stays out of the sweep, but for
    // a new reason: the sweep runs cycle 1 and 08's oracle is cycle 2's
    // answer, so it is judged in the follow-up table instead.
    expect(actual).toEqual({
      "hard-constraint-trap": "scored",
      "closed-on-the-night-trap": "scored",
      "mobility-window-trap": "scored",
      "semantic-geography-trap": "blocked",
      "no-perfect-solution-diet-conflict": "scored",
      "no-perfect-solution-dispersed-group": "scored",
      "rejection-loop-budget": "deferred",
      "six-profiles-outlier": "scored",
    });
  });
});

describe("blockedReason", () => {
  it("names the missing stage for every scenario that is not scored", () => {
    expect(blockedReason(loadScenario("semantic-geography-trap"))).toBe(
      "needs A12"
    );
    // It used to answer "needs A8". A stage that has landed must not still
    // have a reason to be waiting for it.
    expect(blockedReason(loadScenario("rejection-loop-budget"))).toBe(
      "judged under --followup"
    );
  });

  it("raises on a scored scenario rather than inventing a stage", () => {
    expect(() => blockedReason(loadScenario("mobility-window-trap"))).toThrow(
      /is scored, not blocked/
    );
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

describe("judgeConstraint", () => {
  const expected = {
    objection: "soft" as const,
    softPreferences: { venueKinds: ["bar" as const] },
  };

  /** A model's answer, with everything it did not say left empty. */
  function got(answer: Partial<ConstraintUpdate>): ConstraintUpdate {
    return {
      objection: "none",
      softPreferences: {},
      distance: null,
      start: null,
      notThisPlace: false,
      untranslated: null,
      ...answer,
    };
  }

  it("passes the agreed field and nothing else", () => {
    expect(
      judgeConstraint(
        expected,
        got({ objection: "soft", softPreferences: { venueKinds: ["bar"] } })
      ).pass
    ).toBe(true);
  });

  // #217: a list is a set, and a list is never the same object twice — so
  // comparing it with `===` failed every correct answer.
  it("reads a list as a set, whatever its order", () => {
    expect(
      judgeConstraint(
        {
          objection: "soft",
          softPreferences: { cuisines: ["sushi", "italian"] },
        },
        got({
          objection: "soft",
          softPreferences: { cuisines: ["italian", "sushi"] },
        })
      ).pass
    ).toBe(true);
  });

  // Set equality, not containment: an extra field is a preference nobody
  // stated, and it changes the next ranking on its own (#86).
  it("fails an answer that also invented a field", () => {
    const verdict = judgeConstraint(
      expected,
      got({
        objection: "soft",
        softPreferences: { venueKinds: ["bar"], budget: "modest" },
      })
    );

    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toContain("invented budget");
  });

  it("fails a missed field, a wrong value and a wrong objection", () => {
    expect(
      judgeConstraint(expected, got({ objection: "soft" })).reason
    ).toContain("missed venueKinds");

    expect(
      judgeConstraint(
        expected,
        got({ objection: "soft", softPreferences: { venueKinds: ["cafe"] } })
      ).reason
    ).toContain("expected bar");

    expect(judgeConstraint(expected, got({})).reason).toContain(
      'objection "none"'
    );
  });

  // "Nothing mapped" and "the objection was distance" are different answers,
  // and the whole point of recording the kind is being able to tell them apart.
  it("does not accept one unmappable objection for another", () => {
    expect(
      judgeConstraint({ objection: "distance", softPreferences: {} }, got({}))
        .pass
    ).toBe(false);
  });

  // #220: a distance or a time is as much an answer as a preference — right,
  // wrong, missing or invented.
  it("compares a distance and a start whole, and fails one nobody mentioned", () => {
    const tooFar = {
      objection: "distance" as const,
      softPreferences: {},
      distance: { kind: "max_km" as const, km: 2 },
    };

    expect(
      judgeConstraint(
        tooFar,
        got({ objection: "distance", distance: { kind: "max_km", km: 2 } })
      ).pass
    ).toBe(true);
    expect(
      judgeConstraint(
        tooFar,
        got({ objection: "distance", distance: { kind: "closer" } })
      ).reason
    ).toContain("expected");
    expect(
      judgeConstraint(
        expected,
        got({
          objection: "soft",
          softPreferences: { venueKinds: ["bar"] },
          start: { direction: "later" },
        })
      ).reason
    ).toContain("invented start");
  });

  it("asks only that something was set aside as untranslated", () => {
    const parking = {
      objection: "none" as const,
      softPreferences: {},
      untranslated: true as const,
    };

    expect(judgeConstraint(parking, got({ untranslated: "חניה" })).pass).toBe(
      true
    );
    expect(judgeConstraint(parking, got({})).reason).toContain(
      "missed untranslated"
    );
  });
});

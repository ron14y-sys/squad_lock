import { describe, expect, it } from "vitest";

import type {
  Candidate,
  DetourFactor,
  LatLng,
  Participant,
  PreferenceProfile,
  ResolvedContext,
  SearchRegion,
  ShortlistEntry,
  SlotTolerance,
  TimeSlot,
} from "@/lib/types";
import {
  assertToleranceKm,
  BurdenError,
  burdenValue,
  burdensFor,
  clampDetourFactor,
  detourFactorBetween,
  originOf,
  compareLeximin,
  leximinVector,
  rankByLeximin,
  regionContaining,
  scoreCandidates,
  straightLineKm,
  toleranceKmFor,
  type BurdenOptions,
} from "./distance";

/** The same 6-decimal quantisation `leximinVector` applies to its key. */
const quantiseLike = (value: number): number => Math.round(value * 1e6) / 1e6;

/** A leximin vector built straight from burden values, for comparator tests. */
const leximinVectorOf = (values: number[]): number[] =>
  values.map(quantiseLike).sort((a, b) => b - a);

/**
 * Real places, because a distance test that invents its coordinates can only
 * ever check the formula against itself. These two are far enough apart to be
 * worth measuring and well-known enough to be checked against any map.
 */
const ROTHSCHILD: LatLng = { lat: 32.0648, lng: 34.7749 };
const JERUSALEM: LatLng = { lat: 31.7683, lng: 35.2137 };

describe("straight-line distance", () => {
  it("puts a degree of latitude at 111.19 km, at the equator and at 60 north", () => {
    // A meridian is a great circle whatever the longitude, so this is an exact
    // oracle for the radius and the formula together — no map required.
    const atEquator = straightLineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    const atSixty = straightLineKm({ lat: 60, lng: 25 }, { lat: 61, lng: 25 });

    expect(atEquator).toBeCloseTo(111.195, 2);
    expect(atSixty).toBeCloseTo(111.195, 2);
  });

  it("puts Rothschild about 53 km from central Jerusalem", () => {
    // The sanity check the sphere oracle above cannot give: a real pair of
    // places, at the latitude this project actually runs at. Roughly 33 km
    // north-south and 41 km east-west, so a shade under 53 km on the
    // diagonal — which is the straight line, and about 20 km less than the
    // drive. The gap between those two numbers is the reason §5.4 forbids
    // calling any of this travel time.
    expect(straightLineKm(ROTHSCHILD, JERUSALEM)).toBeGreaterThan(52.5);
    expect(straightLineKm(ROTHSCHILD, JERUSALEM)).toBeLessThan(53.5);
  });

  it("is zero between a point and itself, and the same in both directions", () => {
    expect(straightLineKm(ROTHSCHILD, ROTHSCHILD)).toBe(0);
    expect(straightLineKm(ROTHSCHILD, JERUSALEM)).toBeCloseTo(
      straightLineKm(JERUSALEM, ROTHSCHILD),
      12
    );
  });

  it("does not round, so two venues thirty metres apart do not tie", () => {
    // `lib/spike/payload.ts` rounds to 100 m for readability. Doing that here
    // would manufacture exact ties, and resolving past a tie is what leximin
    // is for — so the two functions stay separate on purpose.
    const near = straightLineKm(ROTHSCHILD, { lat: 32.0648, lng: 34.7752 });
    const nearer = straightLineKm(ROTHSCHILD, { lat: 32.0648, lng: 34.7751 });

    expect(near).toBeGreaterThan(nearer);
    expect(near).toBeLessThan(0.1);
  });

  it("refuses a coordinate that is not a point on Earth", () => {
    // A NaN burden does not fail, it randomises: `NaN < x` and `NaN > x` are
    // both false, so a bad coordinate would silently scramble the ranking.
    const cases: LatLng[] = [
      { lat: 91, lng: 34 },
      { lat: -91, lng: 34 },
      { lat: 32, lng: 200 },
      { lat: Number.NaN, lng: 34 },
      { lat: 32, lng: Number.POSITIVE_INFINITY },
    ];

    for (const bad of cases) {
      expect(() => straightLineKm(ROTHSCHILD, bad)).toThrow(BurdenError);
    }
  });

  it("says which end of the journey was the bad one", () => {
    expect(() => straightLineKm({ lat: 91, lng: 0 }, ROTHSCHILD)).toThrow(
      /the origin/
    );
    expect(() => straightLineKm(ROTHSCHILD, { lat: 91, lng: 0 })).toThrow(
      /the destination/
    );
  });
});

describe("the burden formula", () => {
  it("is exactly 1.0 at the distance the person said they were comfortable with", () => {
    // The whole meaning of the number (spec §5.4). 8 km for someone whose
    // stated tolerance is 8 km is precisely their limit, and reads as 1.0.
    expect(burdenValue(8, 1, 8)).toBe(1);
    expect(burdenValue(4, 1, 8)).toBe(0.5);
    expect(burdenValue(12, 1, 8)).toBe(1.5);
  });

  it("scales linearly with the detour factor", () => {
    // The correction A12 will supply: two neighbourhoods a river apart are
    // further in practice than the straight line between them (spec §5.4).
    expect(burdenValue(8, 1.5, 8)).toBe(1.5);
    expect(burdenValue(8, 2, 8)).toBe(2);
  });

  it("clamps a detour factor below 1.0 back up to the straight line", () => {
    // A journey shorter than the straight line between its ends is not a
    // thing. `lib/types/matching.ts` already says a model returning one is
    // wrong; this is where that is enforced.
    expect(clampDetourFactor(0.8)).toBe(1);
    expect(clampDetourFactor(-2)).toBe(1);
    expect(clampDetourFactor(0)).toBe(1);
    expect(burdenValue(8, 0.5, 8)).toBe(1);
  });

  it("treats a detour factor that is missing or nonsense as no correction at all", () => {
    // A correction can be dropped and leave a valid answer behind. This is
    // the half of the asymmetry with `assertToleranceKm` below.
    expect(clampDetourFactor(undefined)).toBe(1);
    expect(clampDetourFactor(Number.NaN)).toBe(1);
    expect(clampDetourFactor(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("keeps a detour factor of 1.0 or more exactly as it was given", () => {
    expect(clampDetourFactor(1)).toBe(1);
    expect(clampDetourFactor(1.35)).toBe(1.35);
  });

  it("throws on a tolerance of zero, a negative one, and one that is not a number", () => {
    // A denominator cannot be dropped the way a correction can — with a
    // broken tolerance there is no answer, so the run fails instead.
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => assertToleranceKm(bad)).toThrow(BurdenError);
      expect(() => burdenValue(8, 1, bad)).toThrow(/cannot be divided by/);
    }
  });

  it("names the person whose tolerance is broken, when it knows who they are", () => {
    // The message goes to a group of friends, so it has to name someone
    // rather than print a row id.
    try {
      assertToleranceKm(0, { id: "u-dana", name: "Dana" });
      expect.unreachable("a tolerance of zero must not be accepted");
    } catch (error) {
      expect(error).toBeInstanceOf(BurdenError);
      const burden = error as BurdenError;
      expect(burden.kind).toBe("bad_tolerance");
      expect(burden.participantId).toBe("u-dana");
      expect(burden.message).toContain("Dana");
    }
  });

  it("refuses a distance that is negative or not a number", () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => burdenValue(bad, 1, 8)).toThrow(BurdenError);
    }
  });

  it("carries no participant when the fault is not a person's", () => {
    try {
      burdenValue(-1, 1, 8);
      expect.unreachable("a negative distance must not be accepted");
    } catch (error) {
      expect((error as BurdenError).participantId).toBeNull();
    }
  });
});

/* -------------------------------------------------------------------------
 * Fixtures for everything below, which needs people and venues rather than
 * bare numbers. Built the way `constraints.test.ts` builds them: a default
 * with nothing interesting in it, and one field overridden per test.
 * ---------------------------------------------------------------------- */

const slot = (startIso: string, endIso: string): TimeSlot => ({
  start: new Date(startIso),
  end: new Date(endIso),
});

/** Monday 7 Sep 2026, 19:00–21:00 local. The default proposed slot. */
const MON_EVENING = slot(
  "2026-09-07T16:00:00.000Z",
  "2026-09-07T18:00:00.000Z"
);
/** Monday 7 Sep 2026, 15:00–17:00 local. The same day, earlier. */
const MON_AFTERNOON = slot(
  "2026-09-07T12:00:00.000Z",
  "2026-09-07T14:00:00.000Z"
);

function profile(
  overrides: Partial<PreferenceProfile> = {}
): PreferenceProfile {
  return {
    id: "p1",
    userId: "u1",
    hardConstraints: { dietary: [], allergies: [], unavailable: [] },
    softPreferences: {
      noiseLevel: "quiet",
      activityStyle: "cultural",
      budget: "modest",
      cuisine: "familiar",
    },
    home: ROTHSCHILD,
    homeNeighbourhood: "Rothschild",
    toleranceKm: 8,
    recurringMobilityRules: [],
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  };
}

function participant(
  userId: string,
  name: string,
  origin: LatLng | null = ROTHSCHILD,
  overrides: Partial<PreferenceProfile> = {}
): Participant {
  return {
    userId,
    name,
    profile: profile({ id: `profile-${userId}`, userId, ...overrides }),
    context: null,
    origin,
    busy: [],
  };
}

function candidate(placeId: string, location: LatLng): Candidate {
  return {
    placeId,
    name: placeId,
    address: null,
    location,
    neighbourhood: null,
  };
}

describe("the origin a person is measured from", () => {
  it("throws, naming the person, when someone has no home location set", () => {
    // The decision this file leans on hardest. Leximin compares vectors
    // position by position, so a vector one person short does not lose
    // information — it *wins* comparisons it should lose. Skipping whoever
    // has not finished onboarding would make them the one person the
    // fairness rule never protects (spec §5.4).
    const dana = participant("u-dana", "Dana", null);

    try {
      originOf(dana);
      expect.unreachable("a participant with no origin must not be scored");
    } catch (error) {
      expect(error).toBeInstanceOf(BurdenError);
      const burden = error as BurdenError;
      expect(burden.kind).toBe("no_origin");
      expect(burden.participantId).toBe("u-dana");
      expect(burden.message).toContain("Dana");
      expect(burden.message).toContain("fill in their details");
    }
  });

  it("uses the origin as given, without re-applying the amendment rule", () => {
    // `Participant.origin` is already resolved upstream — tonight's amendment
    // if there is one, otherwise home (spec §5.7). Re-deriving it here would
    // be a second implementation of a precedence rule that already has one.
    const yotam = participant("u-yotam", "Yotam", JERUSALEM);
    expect(originOf(yotam)).toEqual(JERUSALEM);
  });
});

describe("the detour factor, per region pair", () => {
  const FLORENTIN: SearchRegion = {
    id: "florentin",
    centre: { lat: 32.055, lng: 34.766 },
    radiusKm: 2,
  };
  const RAMAT_GAN: SearchRegion = {
    id: "ramat-gan",
    centre: { lat: 32.082, lng: 34.814 },
    radiusKm: 2,
  };
  const REGIONS = [FLORENTIN, RAMAT_GAN];

  const across: DetourFactor = {
    fromRegionId: "florentin",
    toRegionId: "ramat-gan",
    factor: 1.4,
  };

  it("is 1.0 when no regions and no factors are supplied", () => {
    // The deterministic baseline this file ships with, before A12 exists.
    expect(detourFactorBetween(ROTHSCHILD, JERUSALEM, [], [])).toBe(1);
  });

  it("applies the factor stated for the pair the two ends fall in", () => {
    expect(
      detourFactorBetween(FLORENTIN.centre, RAMAT_GAN.centre, REGIONS, [across])
    ).toBe(1.4);
  });

  it("reads a factor stated in the other direction when there is no exact one", () => {
    // A river with no crossing is the same obstacle both ways, and A12 will
    // state it once rather than twice.
    expect(
      detourFactorBetween(RAMAT_GAN.centre, FLORENTIN.centre, REGIONS, [across])
    ).toBe(1.4);
  });

  it("prefers an exact directed factor to the reversed one", () => {
    // A one-way ramp is not symmetric, so an exact match must never be
    // overridden by the reverse of some other entry.
    const back: DetourFactor = {
      fromRegionId: "ramat-gan",
      toRegionId: "florentin",
      factor: 1.1,
    };

    expect(
      detourFactorBetween(RAMAT_GAN.centre, FLORENTIN.centre, REGIONS, [
        across,
        back,
      ])
    ).toBe(1.1);
  });

  it("clamps a factor below 1.0 that reached it through a region pair", () => {
    const impossible: DetourFactor = {
      fromRegionId: "florentin",
      toRegionId: "ramat-gan",
      factor: 0.6,
    };

    expect(
      detourFactorBetween(FLORENTIN.centre, RAMAT_GAN.centre, REGIONS, [
        impossible,
      ])
    ).toBe(1);
  });

  it("applies nothing to a point that lies outside every region", () => {
    // A detour factor is a claim about two *named* areas. Stretching one over
    // a point in neither would be inventing a fact about geography.
    expect(
      detourFactorBetween(JERUSALEM, RAMAT_GAN.centre, REGIONS, [across])
    ).toBe(1);
  });

  it("puts a point inside two overlapping regions in the nearer one", () => {
    // The regions overlap by design: spec §5.4 puts one query centre on each
    // participant's neighbourhood, and neighbours share ground.
    const wide: SearchRegion = {
      id: "wide",
      centre: { lat: 32.09, lng: 34.79 },
      radiusKm: 12,
    };

    expect(regionContaining(FLORENTIN.centre, [wide, FLORENTIN])?.id).toBe(
      "florentin"
    );
    expect(regionContaining(JERUSALEM, [wide, FLORENTIN])).toBeNull();
  });
});

describe("how far this person will travel, at this hour", () => {
  it("falls back to the profile's standing tolerance when nothing per-slot is given", () => {
    const noa = participant("u-noa", "Noa");
    expect(toleranceKmFor(noa, MON_EVENING, [])).toBe(8);
  });

  it("uses the per-slot tolerance for the slot it names, and the profile for the others", () => {
    // The Resolver may narrow a tolerance freely — that only moves a
    // candidate down a list, which the next cycle can undo (spec §4.1g).
    const noa = participant("u-noa", "Noa");
    const tight: SlotTolerance = {
      participantId: "u-noa",
      slot: MON_AFTERNOON,
      toleranceKm: 2,
    };

    expect(toleranceKmFor(noa, MON_AFTERNOON, [tight])).toBe(2);
    expect(toleranceKmFor(noa, MON_EVENING, [tight])).toBe(8);
  });

  it("does not read another participant's per-slot tolerance", () => {
    const noa = participant("u-noa", "Noa");
    const someoneElse: SlotTolerance = {
      participantId: "u-rami",
      slot: MON_EVENING,
      toleranceKm: 1,
    };

    expect(toleranceKmFor(noa, MON_EVENING, [someoneElse])).toBe(8);
  });

  it("matches a slot by its instants, not by object identity", () => {
    // Two distinct TimeSlot objects naming the same two instants are the same
    // slot. `checkChosenPair` sidesteps this same trap by hand in A2.
    const noa = participant("u-noa", "Noa");
    const sameTimes = slot(
      "2026-09-07T16:00:00.000Z",
      "2026-09-07T18:00:00.000Z"
    );

    expect(sameTimes).not.toBe(MON_EVENING);
    expect(
      toleranceKmFor(noa, sameTimes, [
        { participantId: "u-noa", slot: MON_EVENING, toleranceKm: 3 },
      ])
    ).toBe(3);
  });

  it("throws, naming the person, when the tolerance it found cannot be divided by", () => {
    const rami = participant("u-rami", "Rami", ROTHSCHILD, { toleranceKm: 0 });
    expect(() => toleranceKmFor(rami, MON_EVENING, [])).toThrow(/Rami/);
  });
});

describe("the burdens for one venue", () => {
  const VENUE = candidate("v1", { lat: 32.08, lng: 34.78 });

  it("produces one burden per participant per slot, flat", () => {
    // Flat is the shape `ShortlistEntry.burdens` already declares, and the
    // shape B7c's gate wants — it tests individual cells.
    const people = [
      participant("u-noa", "Noa"),
      participant("u-rami", "Rami", JERUSALEM),
    ];

    const burdens = burdensFor(VENUE, people, [MON_EVENING, MON_AFTERNOON]);

    expect(burdens).toHaveLength(4);
    expect(burdens.every((b) => b.candidatePlaceId === "v1")).toBe(true);
    expect(new Set(burdens.map((b) => b.participantId))).toEqual(
      new Set(["u-noa", "u-rami"])
    );
  });

  it("keeps the burden the same across slots when only the venue is fixed", () => {
    // Distance does not change at 18:00. Only the denominator can.
    const noa = participant("u-noa", "Noa");
    const [evening, afternoon] = burdensFor(
      VENUE,
      [noa],
      [MON_EVENING, MON_AFTERNOON]
    );

    expect(evening.value).toBeCloseTo(afternoon.value, 12);
  });

  it("takes a whole ResolvedContext without any adaptation", () => {
    // The A12 seam. `BurdenOptions` is field-for-field a Partial of this, so
    // the Resolver's output passes in wholesale and no signature changes.
    const resolved: ResolvedContext = {
      searchRegions: [],
      detourFactors: [],
      tolerances: [
        { participantId: "u-noa", slot: MON_EVENING, toleranceKm: 4 },
      ],
    };
    const wholesale: BurdenOptions = resolved;

    const noa = participant("u-noa", "Noa");
    const [burden] = burdensFor(VENUE, [noa], [MON_EVENING], wholesale);
    const [baseline] = burdensFor(VENUE, [noa], [MON_EVENING]);

    // Half the tolerance, so exactly twice the burden.
    expect(burden.value).toBeCloseTo(baseline.value * 2, 12);
  });

  it("refuses to score a venue for someone with no origin", () => {
    const dana = participant("u-dana", "Dana", null);
    expect(() => burdensFor(VENUE, [dana], [MON_EVENING])).toThrow(
      /no home location/
    );
  });
});

describe("the pre-rank vector", () => {
  const VENUE = candidate("v1", { lat: 32.08, lng: 34.78 });

  it("uses each participant's most permissive slot, which is their lowest burden", () => {
    // Spec §5.4 and §4.1g: the pre-rank must use the most permissive window,
    // so that time-dependence never narrows what gets retrieved. Distance
    // does not vary by hour, so the widest tolerance is the lowest burden and
    // no second pass over the tolerances is needed.
    const noa = participant("u-noa", "Noa");
    const tolerances: SlotTolerance[] = [
      { participantId: "u-noa", slot: MON_AFTERNOON, toleranceKm: 2 },
      { participantId: "u-noa", slot: MON_EVENING, toleranceKm: 16 },
    ];

    const burdens = burdensFor(VENUE, [noa], [MON_AFTERNOON, MON_EVENING], {
      tolerances,
    });
    const [worst] = leximinVector(burdens, [noa]);
    const evening = burdens.find((b) => b.slot === MON_EVENING)!;

    expect(worst).toBeCloseTo(quantiseLike(evening.value), 6);
  });

  it("is sorted worst-first", () => {
    // The comparator's precondition, and the order §5.4 reads them in.
    const people = [
      participant("u-near", "Near"),
      participant("u-far", "Far", JERUSALEM),
    ];

    const vector = leximinVector(
      burdensFor(VENUE, people, [MON_EVENING]),
      people
    );

    expect(vector[0]).toBeGreaterThan(vector[1]);
  });

  it("has one entry per participant whatever the number of slots", () => {
    const people = [
      participant("u-noa", "Noa"),
      participant("u-rami", "Rami", JERUSALEM),
    ];

    expect(
      leximinVector(
        burdensFor(VENUE, people, [MON_EVENING, MON_AFTERNOON]),
        people
      )
    ).toHaveLength(2);
  });

  it("refuses to build a vector that is missing somebody", () => {
    // An empty or short vector must never be allowed to win a comparison.
    const noa = participant("u-noa", "Noa");
    const absent = participant("u-ghost", "Ghost");

    expect(() =>
      leximinVector(burdensFor(VENUE, [noa], [MON_EVENING]), [noa, absent])
    ).toThrow(/Ghost/);
  });
});

describe("leximin", () => {
  it("prefers a venue moderately inconvenient for everyone to one next door to three and an hour from the fourth", () => {
    // Acceptance test 1, from tasks/todo.md. This is the failure §5.4 exists
    // to prevent: averaging would pick the first venue, and the fourth person
    // eventually stops showing up.
    const nextDoorToThree = [1.9, 0.05, 0.05, 0.05];
    const moderateForEveryone = [0.8, 0.7, 0.7, 0.6];

    expect(compareLeximin(moderateForEveryone, nextDoorToThree)).toBeLessThan(
      0
    );
  });

  it("separates two candidates tying on the worst-off participant by the second-worst", () => {
    // Acceptance test 2, and the spec's own example. This is exactly what
    // plain minimax cannot do: it calls these two equivalent, the tie falls
    // through to star rating, and the fairness silently disappears.
    expect(compareLeximin([1.8, 1.2, 0.9], [1.8, 1.5, 0.4])).toBeLessThan(0);
  });

  it("goes on to the third-worst when the first two tie", () => {
    // Pins that the comparison runs the whole vector, not two levels of it.
    expect(compareLeximin([1.8, 1.2, 0.3], [1.8, 1.2, 0.9])).toBeLessThan(0);
  });

  it("calls two identical vectors a tie", () => {
    expect(compareLeximin([1.8, 1.2, 0.9], [1.8, 1.2, 0.9])).toBe(0);
  });

  it("refuses to compare vectors of different lengths", () => {
    // A missing participant must not win by absence.
    expect(() => compareLeximin([1.8, 1.2], [1.8, 1.2, 0.9])).toThrow(
      BurdenError
    );
  });

  it("treats three vectors differing by a nanometre as one three-way tie", () => {
    // The reason the key is quantised rather than the comparison fuzzed: an
    // epsilon comparator is not transitive, and `Array.prototype.sort` on a
    // non-transitive comparator gives an order that depends on input order.
    const a = leximinVectorOf([1.154]);
    const b = leximinVectorOf([1.154 + 1e-12]);
    const c = leximinVectorOf([1.154 + 2e-12]);

    expect(compareLeximin(a, b)).toBe(0);
    expect(compareLeximin(b, c)).toBe(0);
    expect(compareLeximin(a, c)).toBe(0);
  });
});

describe("ranking the candidates", () => {
  const NEAR_THREE = candidate("v-near-three", { lat: 32.0648, lng: 34.7749 });
  const MODERATE = candidate("v-moderate", { lat: 32.03, lng: 34.79 });

  /** Three people together in the centre, and one out in Jerusalem. */
  const GROUP = [
    participant("u-a", "Ayelet"),
    participant("u-b", "Boaz"),
    participant("u-c", "Carmel"),
    participant("u-d", "Dror", { lat: 31.99, lng: 34.81 }),
  ];

  const INPUT = {
    candidates: [NEAR_THREE, MODERATE],
    participants: GROUP,
    viableSlots: new Map([
      ["v-near-three", [MON_EVENING]],
      ["v-moderate", [MON_EVENING]],
    ]),
  };

  it("ranks the venue that spreads the burden above the one that concentrates it", () => {
    // The same acceptance case as above, but end to end over coordinates
    // rather than hand-written vectors.
    const ranked = rankByLeximin(scoreCandidates(INPUT));

    expect(ranked[0].candidate.placeId).toBe("v-moderate");
    expect(ranked[0].leximin[0]).toBeLessThan(ranked[1].leximin[0]);
  });

  it("hands B7c rows that are already ShortlistEntry shaped", () => {
    // The intersection type, at runtime: no mapping step before persistence.
    const [score] = scoreCandidates(INPUT);
    const entry: ShortlistEntry = score;

    expect(entry.candidate.placeId).toBe("v-near-three");
    expect(entry.viableSlots).toEqual([MON_EVENING]);
    expect(entry.burdens).toHaveLength(GROUP.length);
  });

  it("returns the scores in input order, leaving the ranking to a separate call", () => {
    // B7c needs them unranked: once for the gate on T, once for the rating
    // list that runs in parallel with this one (spec §5.4).
    expect(scoreCandidates(INPUT).map((s) => s.candidate.placeId)).toEqual([
      "v-near-three",
      "v-moderate",
    ]);
  });

  it("does not mutate the array it was given", () => {
    const scores = scoreCandidates(INPUT);
    const before = scores.map((s) => s.candidate.placeId);
    rankByLeximin(scores);

    expect(scores.map((s) => s.candidate.placeId)).toEqual(before);
  });

  it("breaks an exact tie on placeId, so the order Places answered in cannot decide it", () => {
    // Spec §5.4: two identical Places requests are not guaranteed to come
    // back the same way, so sort stability is not something to lean on.
    const twin = candidate("v-aaa", NEAR_THREE.location);
    const scores = scoreCandidates({
      ...INPUT,
      candidates: [NEAR_THREE, twin],
      viableSlots: new Map([
        ["v-near-three", [MON_EVENING]],
        ["v-aaa", [MON_EVENING]],
      ]),
    });

    expect(compareLeximin(scores[0].leximin, scores[1].leximin)).toBe(0);
    expect(rankByLeximin(scores)[0].candidate.placeId).toBe("v-aaa");
    expect(rankByLeximin([...scores].reverse())[0].candidate.placeId).toBe(
      "v-aaa"
    );
  });

  it("refuses a candidate that arrived with no viable slot", () => {
    // B7c should have dropped it; an empty vector must never be scored.
    expect(() => scoreCandidates({ ...INPUT, viableSlots: new Map() })).toThrow(
      /no viable slot/
    );
  });

  it("gives the same answer twice for the same input", () => {
    // Pure: no clock, no randomness, no I/O (spec §9).
    expect(rankByLeximin(scoreCandidates(INPUT))).toEqual(
      rankByLeximin(scoreCandidates(INPUT))
    );
  });
});

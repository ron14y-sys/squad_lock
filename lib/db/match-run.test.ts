import { describe, expect, it } from "vitest";

import type { LlmCallRecord } from "@/lib/llm/client";
import type { MatchRunDraft } from "@/lib/matching/agent";
import type { CandidateScore } from "@/lib/matching/distance";
import { toMatchRunCreate } from "./match-run";

/**
 * The mapping, with no database anywhere near it.
 *
 * Everything this file covers is a decision — which column a value lands in,
 * what a missing cost becomes, what happens to the `Date`s inside a shortlist.
 * The database round trip is `__tests__/match-run-db.test.ts`, which skips
 * itself until a `DATABASE_URL` exists (there is none in dev or CI yet).
 */

const SLOT_START = new Date("2026-09-10T17:00:00.000Z");
const SLOT_END = new Date("2026-09-10T20:00:00.000Z");

/**
 * A3's output, which is what a shortlist really is: `CandidateScore` *is* a
 * `ShortlistEntry` with the ranking key still attached, so it persists with no
 * mapping step (`lib/types/matching.ts`).
 */
const SCORE: CandidateScore = {
  candidate: {
    placeId: "place-near",
    name: "Near",
    address: "12 Rothschild",
    location: { lat: 32.0648, lng: 34.7749 },
    neighbourhood: "Rothschild",
  },
  burdens: [
    {
      candidatePlaceId: "place-near",
      participantId: "u-dana",
      slot: { start: SLOT_START, end: new Date("2026-09-10T20:00:00.000Z") },
      value: 0.42,
    },
  ],
  viableSlots: [
    { start: SLOT_START, end: new Date("2026-09-10T20:00:00.000Z") },
  ],
  leximin: [0.42],
};

const DRAFT: MatchRunDraft = {
  meetingId: "meeting-1",
  cycleNumber: 2,
  shortlist: [SCORE],
  options: [
    {
      rank: 1,
      venue: {
        placeId: "place-near",
        name: "Near",
        address: "12 Rothschild",
        location: { lat: 32.0648, lng: 34.7749 },
      },
      proposedDatetime: SLOT_START,
      proposedEnd: SLOT_END,
      participantJustifications: { "u-dana": "A ten-minute walk for you." },
      tradeoffs: { tradedAway: "Yoav walks further than he would to Middle." },
      unverified: [],
    },
    {
      rank: 2,
      venue: {
        placeId: null,
        name: "Somewhere with no Places id",
        address: null,
        location: null,
      },
      proposedDatetime: SLOT_START,
      proposedEnd: SLOT_END,
      participantJustifications: { "u-dana": "Quieter, and still close." },
      tradeoffs: { tradedAway: "" },
      unverified: [{ kind: "opening_hours" as const }],
    },
  ],
};

const CALL: LlmCallRecord = {
  task: "matching",
  model: "gemini-3.6-flash",
  thinkingLevel: "low",
  ms: 4711,
  msToFirstText: 1200,
  usage: {
    inputTokens: 3200,
    outputTokens: 1566,
    thoughtTokens: 24299,
    cachedTokens: 0,
  },
  cost: { model: "gemini-3.6-flash", usd: 0.00821, basis: "exact" },
};

/** Pure, and its arguments are constants — computed once, asserted many times. */
const DATA = toMatchRunCreate(DRAFT, CALL);

describe("a run, as a row", () => {
  it("carries the meeting and the cycle it belongs to", () => {
    expect(DATA.meetingId).toBe("meeting-1");
    expect(DATA.cycleNumber).toBe(2);
  });

  it("stores the whole shortlist, burdens included", () => {
    // §4.1d: impossible to reconstruct retroactively. The venues, their hours
    // and everyone's calendars will all have moved on by the time anyone asks.
    const shortlist = DATA.shortlist as {
      burdens: { value: number }[];
    }[];

    expect(shortlist[0].burdens[0].value).toBe(0.42);
  });

  it("turns the Dates inside the shortlist into strings the driver accepts", () => {
    const shortlist = DATA.shortlist as {
      viableSlots: { start: unknown }[];
    }[];

    expect(shortlist[0].viableSlots[0].start).toBe("2026-09-10T17:00:00.000Z");
  });

  it("keeps proposedDatetime a real Date, because it is a timestamp column", () => {
    // The one time value that is NOT inside a json blob. Serialising it too
    // would write a string into a `timestamp`, which Postgres would either
    // reject or silently reinterpret.
    expect(
      toMatchRunCreate(DRAFT, CALL).options.create[0].proposedDatetime
    ).toBeInstanceOf(Date);
  });
});

describe("what the run cost", () => {
  it("records tokens, duration, model and thinking level", () => {
    expect(DATA.model).toBe("gemini-3.6-flash");
    expect(DATA.thinkingLevel).toBe("low");
    expect(DATA.durationMs).toBe(4711);
    expect(DATA.inputTokens).toBe(3200);
    expect(DATA.outputTokens).toBe(1566);
    expect(DATA.thoughtTokens).toBe(24299);
    expect(DATA.costUsd).toBe(0.00821);
    expect(DATA.costBasis).toBe("exact");
  });

  it("leaves an unpriced model's cost null, never zero", () => {
    // A zero here would average into A5's per-scenario total as a real
    // measurement. `basis` is what says the number is missing on purpose.
    const unpriced: LlmCallRecord = {
      ...CALL,
      model: "gemini-4-something-new",
      cost: { model: "gemini-4-something-new", usd: null, basis: "unknown" },
    };

    const data = toMatchRunCreate(DRAFT, unpriced);

    expect(data.costUsd).toBeNull();
    expect(data.costBasis).toBe("unknown");
    // The tokens are still real, even when the price is not.
    expect(data.inputTokens).toBe(3200);
  });

  it("leaves every cost column null when there was no call to price", () => {
    const data = toMatchRunCreate(DRAFT);

    expect(data.model).toBeNull();
    expect(data.durationMs).toBeNull();
    expect(data.inputTokens).toBeNull();
    expect(data.costUsd).toBeNull();
    expect(data.costBasis).toBeNull();
    // The run itself is still perfectly writable.
    expect(data.options.create).toHaveLength(2);
  });
});

describe("the options", () => {
  it("writes one row per rank, in rank order", () => {
    const options = DATA.options.create;

    expect(options.map((option) => option.rank)).toEqual([1, 2]);
  });

  it("flattens the venue snapshot into its four columns", () => {
    const first = DATA.options.create[0];

    expect(first.venuePlaceId).toBe("place-near");
    expect(first.venueName).toBe("Near");
    expect(first.venueAddress).toBe("12 Rothschild");
    expect(first.venueLat).toBeCloseTo(32.0648, 6);
    expect(first.venueLng).toBeCloseTo(34.7749, 6);
  });

  it("writes null coordinates rather than zeroes for a venue with no location", () => {
    // 0,0 is a real place in the Gulf of Guinea. A missing coordinate that
    // reads as one would put a venue 3,000 km away in every later distance.
    const second = DATA.options.create[1];

    expect(second.venueLat).toBeNull();
    expect(second.venueLng).toBeNull();
    expect(second.venuePlaceId).toBeNull();
  });

  it("keeps each viewer's own justification", () => {
    const first = DATA.options.create[0];

    expect(first.participantJustifications).toEqual({
      "u-dana": "A ten-minute walk for you.",
    });
  });

  it("stores the trade-off, which no participant is ever shown", () => {
    const first = DATA.options.create[0];

    expect(first.tradeoffs).toEqual({
      tradedAway: "Yoav walks further than he would to Middle.",
    });
  });

  it("stores what could not be verified, which every participant IS shown", () => {
    // The structured fact, not the rendered sentence — the app is Hebrew and
    // RTL, so the prose is `unverifiedNote` in lib/format/hebrew-labels.ts.
    const options = DATA.options.create;

    expect(options[0].unverified).toEqual([]);
    expect(options[1].unverified).toEqual([{ kind: "opening_hours" }]);
  });
});

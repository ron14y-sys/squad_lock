import { describe, expect, it } from "vitest";

import type {
  Candidate,
  LatLng,
  Participant,
  PreferenceProfile,
  TimeSlot,
} from "@/lib/types";
import {
  filterPairs,
  HardConstraintError,
  type VenueDietaryFacts,
} from "./constraints";
import { rankViable } from "./distance";
import { unverifiedNote } from "@/lib/format/hebrew-labels";
import {
  AgentAnswerError,
  buildPayload,
  interpretAnswer,
  runMatchingAgent,
  type MatchAgentInput,
} from "./agent";
import { pairId, slotId } from "./schemas";

/**
 * A4's tests run the **whole** interpretation path — schema, structure and
 * A2's post-check — against hand-written answers, with no key, no quota and no
 * network.
 *
 * That is deliberate. The acceptance line is "a malformed response is rejected
 * rather than accepted", and a real call cannot prove it: a model that happens
 * to behave proves nothing about what happens when it does not. So every
 * answer below is written by hand, including the ones a model should never
 * produce.
 *
 * The one thing here that does make a real call is the eval-scenario run in
 * `__tests__/eval-agent.test.ts`, which skips itself without an API key.
 */

/* ------------------------------------------------------------------ the cast */

const ROTHSCHILD: LatLng = { lat: 32.0648, lng: 34.7749 };
const FLORENTIN: LatLng = { lat: 32.056, lng: 34.7655 };
const JAFFA: LatLng = { lat: 32.0517, lng: 34.7503 };

function profile(
  overrides: Partial<PreferenceProfile> = {}
): PreferenceProfile {
  return {
    id: "p1",
    userId: "u1",
    hardConstraints: { dietary: [], allergies: [], unavailable: [] },
    softPreferences: { noiseLevel: "quiet" },
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
  origin: LatLng = ROTHSCHILD,
  overrides: Partial<PreferenceProfile> = {}
): Participant {
  return {
    userId,
    name,
    profile: profile({
      id: `profile-${userId}`,
      userId,
      home: origin,
      ...overrides,
    }),
    context: null,
    origin,
    busy: [],
  };
}

function candidate(
  placeId: string,
  name: string,
  location: LatLng,
  hours = true
): Candidate {
  return {
    placeId,
    name,
    address: null,
    location,
    neighbourhood: null,
    rating: 4.5,
    // The whole evening, so hours never decide anything these tests are about.
    ...(hours
      ? { openingHours: [{ weekdays: [], from: "17:00", to: "23:59" }] }
      : {}),
  };
}

const DANA = participant("u-dana", "Dana", ROTHSCHILD);
const YOAV = participant("u-yoav", "Yoav", FLORENTIN);

const THURSDAY: TimeSlot = {
  start: new Date("2026-09-10T17:00:00.000Z"), // 20:00 Asia/Jerusalem
  end: new Date("2026-09-10T20:00:00.000Z"), // 23:00
};

const NEAR = candidate("place-near", "Near", ROTHSCHILD);
const MIDDLE = candidate("place-middle", "Middle", FLORENTIN);
const FAR = candidate("place-far", "Far", JAFFA);
/** No opening hours at all — A2 marks it unverified rather than dropping it. */
const UNCHECKED = candidate("place-unchecked", "Unchecked", ROTHSCHILD, false);

/**
 * A whole run's worth of input, built by actually running A2 and A3 rather
 * than by hand. A fixture that hand-writes the viable set can drift from what
 * the filter really produces, which is the mistake #86 was.
 */
function inputFor(
  candidates: Candidate[],
  participants: Participant[] = [DANA, YOAV],
  venueFacts?: Record<string, VenueDietaryFacts>
): MatchAgentInput {
  const slots = [THURSDAY];
  const filtered = filterPairs({ candidates, participants, slots, venueFacts });

  return {
    meetingId: "meeting-1",
    cycleNumber: 1,
    participants,
    candidates,
    slots,
    viable: filtered.viable,
    ranked: rankViable(filtered, candidates, participants),
    venueFacts,
  };
}

/** An answer in the shape the model returns, so a test can bend one field. */
function answer(
  options: {
    rank: number;
    venue: string;
    slot?: string;
    people?: string[];
    traded?: string;
  }[]
): string {
  return JSON.stringify({
    options: options.map((option) => ({
      rank: option.rank,
      venue_id: option.venue,
      slot_id: option.slot ?? slotId(THURSDAY),
      justifications: (option.people ?? ["u-dana", "u-yoav"]).map((id) => ({
        participant_id: id,
        reason:
          "A ten-minute walk for you, and they take the allergy seriously.",
      })),
      traded_away:
        option.traded ?? "Yoav walks a little further than he would to Near.",
    })),
  });
}

/* ------------------------------------------------------------- the happy path */

describe("a well-formed answer", () => {
  it("becomes a run draft with one option per rank, in rank order", () => {
    const input = inputFor([NEAR, MIDDLE, FAR]);

    const draft = interpretAnswer(
      answer([
        { rank: 1, venue: "place-middle" },
        { rank: 2, venue: "place-near" },
        { rank: 3, venue: "place-far" },
      ]),
      input
    );

    expect(draft.meetingId).toBe("meeting-1");
    expect(draft.cycleNumber).toBe(1);
    expect(draft.options.map((o) => o.rank)).toEqual([1, 2, 3]);
    expect(draft.options.map((o) => o.venue.name)).toEqual([
      "Middle",
      "Near",
      "Far",
    ]);
  });

  it("carries the venue as a snapshot, because Places data changes later", () => {
    const draft = interpretAnswer(
      answer([{ rank: 1, venue: "place-near" }]),
      inputFor([NEAR])
    );

    expect(draft.options[0].venue).toEqual({
      placeId: "place-near",
      name: "Near",
      address: null,
      location: ROTHSCHILD,
    });
  });

  it("proposes the start of the slot as the datetime", () => {
    const draft = interpretAnswer(
      answer([{ rank: 1, venue: "place-near" }]),
      inputFor([NEAR])
    );

    expect(draft.options[0].proposedDatetime).toEqual(THURSDAY.start);
  });

  it("keys the justifications by user id, so a viewer gets their own", () => {
    const draft = interpretAnswer(
      answer([{ rank: 1, venue: "place-near" }]),
      inputFor([NEAR])
    );

    expect(Object.keys(draft.options[0].participantJustifications)).toEqual([
      "u-dana",
      "u-yoav",
    ]);
  });

  it("persists what was traded away, which no participant is ever shown", () => {
    const draft = interpretAnswer(
      answer([
        {
          rank: 1,
          venue: "place-near",
          traded: "Yoav's journey, for the quiet.",
        },
      ]),
      inputFor([NEAR])
    );

    expect(draft.options[0].tradeoffs).toEqual({
      tradedAway: "Yoav's journey, for the quiet.",
    });
  });

  it("keeps the shortlist that went in, so the run is persisted in full", () => {
    const input = inputFor([NEAR, MIDDLE]);
    const draft = interpretAnswer(
      answer([
        { rank: 1, venue: "place-near" },
        { rank: 2, venue: "place-middle" },
      ]),
      input
    );

    // §4.1d: the shortlist is impossible to reconstruct retroactively.
    expect(draft.shortlist).toBe(input.ranked);
    expect(draft.shortlist[0].burdens.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------ the unverified notice */

describe("what could not be verified", () => {
  it("comes from A2's findings, not from anything the model wrote", () => {
    const draft = interpretAnswer(
      answer([{ rank: 1, venue: "place-unchecked" }]),
      inputFor([UNCHECKED])
    );

    // The answer above says nothing about verification. The fact is attached
    // anyway, because it is A2's to state and not the model's (spec §4.4).
    expect(draft.options[0].unverified).toEqual([{ kind: "opening_hours" }]);
  });

  it("is empty when everything about the pair was checked", () => {
    const draft = interpretAnswer(
      answer([{ rank: 1, venue: "place-near" }]),
      inputFor([NEAR])
    );

    expect(draft.options[0].unverified).toEqual([]);
  });

  it("is the fact and not the sentence — the prose is the formatting layer's", () => {
    // The app is Hebrew and RTL. Storing rendered English here would make
    // every historical row a translation problem, which is why the draft
    // carries the structured fact and `lib/format` renders it.
    const draft = interpretAnswer(
      answer([{ rank: 1, venue: "place-unchecked" }]),
      inputFor([UNCHECKED])
    );

    expect(typeof draft.options[0].unverified[0]).toBe("object");
    expect(unverifiedNote(draft.options[0].unverified)).toContain(
      "שעות הפתיחה"
    );
  });
});

/* --------------------------------------------------------- answers we refuse */

describe("an answer that is not the right shape", () => {
  it("rejects text that is not JSON, and points at truncation", () => {
    expect(() =>
      interpretAnswer("Sorry, I think Near is best!", inputFor([NEAR]))
    ).toThrow(AgentAnswerError);
    expect(() => interpretAnswer("Sorry!", inputFor([NEAR]))).toThrow(
      /truncated/
    );
  });

  it("rejects an object that is missing a required field", () => {
    const missing = JSON.stringify({
      options: [
        {
          rank: 1,
          venue_id: "place-near",
          slot_id: slotId(THURSDAY),
          justifications: [
            { participant_id: "u-dana", reason: "Close to you." },
          ],
          // traded_away omitted
        },
      ],
    });

    expect(() => interpretAnswer(missing, inputFor([NEAR]))).toThrow(
      AgentAnswerError
    );
  });

  it("rejects an empty justification, which is a field filled in rather than written", () => {
    const empty = JSON.stringify({
      options: [
        {
          rank: 1,
          venue_id: "place-near",
          slot_id: slotId(THURSDAY),
          justifications: [{ participant_id: "u-dana", reason: "" }],
          traded_away: "",
        },
      ],
    });

    expect(() => interpretAnswer(empty, inputFor([NEAR]))).toThrow(
      AgentAnswerError
    );
  });

  it("accepts one option when only one pair was allowed", () => {
    // Demanding three from a shortlist of one would fail a run whose answer
    // was correct — which is exactly eval scenario 01.
    const draft = interpretAnswer(
      answer([{ rank: 1, venue: "place-near" }]),
      inputFor([NEAR])
    );

    expect(draft.options).toHaveLength(1);
  });

  /**
   * The structural rules, each stated once.
   *
   * A table rather than eight near-identical blocks: every row is the same
   * assertion with a different answer and a different message, and the next
   * rule (A6's coverage check) should be one line here rather than a tenth
   * copy of the same five.
   */
  it.each([
    {
      rule: "too few options for the pairs on offer",
      options: [
        { rank: 1, venue: "place-near" },
        { rank: 2, venue: "place-middle" },
      ],
      pool: [NEAR, MIDDLE, FAR],
      throws: /expected 3 ranked option/,
    },
    {
      rule: "a rank that repeats",
      options: [
        { rank: 1, venue: "place-near" },
        { rank: 1, venue: "place-middle" },
      ],
      pool: [NEAR, MIDDLE],
      throws: /ranks must run 1\.\.2/,
    },
    {
      rule: "a rank that skips a number",
      options: [
        { rank: 1, venue: "place-near" },
        { rank: 3, venue: "place-middle" },
      ],
      pool: [NEAR, MIDDLE],
      throws: /ranks must run 1\.\.2/,
    },
    {
      // A8b carries ranks 2 and 3 into the next cycle; the same pair twice
      // would carry one candidate forward as if it were two.
      rule: "the same pair ranked twice",
      options: [
        { rank: 1, venue: "place-near" },
        { rank: 2, venue: "place-near" },
      ],
      pool: [NEAR, MIDDLE],
      throws: /ranked more than once/,
    },
    {
      rule: "a slot id nobody offered",
      options: [
        { rank: 1, venue: "place-near", slot: "1757000000000-1757010000000" },
      ],
      pool: [NEAR],
      throws: /was not offered/,
    },
    {
      rule: "a justification addressed to somebody not in the meeting",
      options: [
        { rank: 1, venue: "place-near", people: ["u-dana", "u-ghost"] },
      ],
      pool: [NEAR],
      throws: /not in this meeting/,
    },
    {
      rule: "two justifications addressed to the same person",
      options: [{ rank: 1, venue: "place-near", people: ["u-dana", "u-dana"] }],
      pool: [NEAR],
      throws: /the same person twice/,
    },
  ])("rejects $rule", ({ options, pool, throws }) => {
    expect(() => interpretAnswer(answer(options), inputFor(pool))).toThrow(
      throws
    );
  });

  it("refuses to make the call at all when no pair survived the filter", async () => {
    // An empty viable set is `stuck`, and the group is owed the reason. Asking
    // a model to choose from nothing would turn that into a fabricated answer,
    // so the guard sits before `generate` — this throws without a key, which
    // is how we know no call was attempted.
    await expect(
      runMatchingAgent({ ...inputFor([NEAR]), viable: [] })
    ).rejects.toThrow(/`stuck`, not a matching run/);
  });

  it("refuses to make the call with nobody in the meeting", async () => {
    await expect(
      runMatchingAgent({ ...inputFor([NEAR]), participants: [] })
    ).rejects.toThrow(/at least one participant/);
  });
});

/* ---------------------------------------------- answers that break a constraint */

describe("the A2 post-check, on the real answer", () => {
  it("throws when the venue was never a candidate", () => {
    expect(() =>
      interpretAnswer(
        answer([{ rank: 1, venue: "place-invented" }]),
        inputFor([NEAR])
      )
    ).toThrow(HardConstraintError);
  });

  it("throws when the chosen venue breaks somebody's dietary constraint", () => {
    // The filter would have dropped this pair, so the only way it can be the
    // answer is that the model produced it anyway. That is exactly the case
    // §4.1b keeps a post-check for.
    const kosherDana = participant("u-dana", "Dana", ROTHSCHILD, {
      hardConstraints: { dietary: ["kosher"], allergies: [], unavailable: [] },
    });
    const input = inputFor([NEAR, MIDDLE], [kosherDana, YOAV], {
      "place-near": { violates: ["kosher"] },
      "place-middle": { satisfies: ["kosher"] },
    });

    expect(() =>
      interpretAnswer(
        answer([
          { rank: 1, venue: "place-near" },
          { rank: 2, venue: "place-middle" },
        ]),
        {
          ...input,
          viable: [
            ...input.viable,
            { candidatePlaceId: "place-near", slot: THURSDAY, unverified: [] },
          ],
        }
      )
    ).toThrow(HardConstraintError);
  });

  it("checks rank 3 too, because ranks 2 and 3 are persisted and shown as considered", () => {
    const input = inputFor([NEAR, MIDDLE, FAR]);

    expect(() =>
      interpretAnswer(
        answer([
          { rank: 1, venue: "place-near" },
          { rank: 2, venue: "place-middle" },
          { rank: 3, venue: "place-invented" },
        ]),
        input
      )
    ).toThrow(HardConstraintError);
  });
});

/* ------------------------------------------------------------------ the payload */

describe("what the model is shown", () => {
  it("lists every allowed pair with its burden on each person, by name", () => {
    const payload = buildPayload(inputFor([NEAR, MIDDLE]));

    expect(payload).toContain('"venue_name": "Near"');
    expect(payload).toContain('"Dana"');
    expect(payload).toContain('"burden_by_person"');
  });

  it("marks a pair verified or not, so the model can prefer the checked one", () => {
    const payload = buildPayload(inputFor([NEAR, UNCHECKED]));

    expect(payload).toContain('"verified": true');
    expect(payload).toContain('"verified": false');
  });

  it("never invents a preference for somebody who stated none", () => {
    // #86, question 5. An absent field stays absent — it is not "no
    // preference", which is a value the model could reason about and weigh.
    const silent = participant("u-silent", "Noa", ROTHSCHILD, {
      softPreferences: {},
    });
    const payload = buildPayload(inputFor([NEAR], [DANA, silent]));

    const people = JSON.parse(
      payload.slice(payload.indexOf("["), payload.indexOf("]") + 1)
    ) as { name: string; stated_preferences: Record<string, unknown> }[];
    const noa = people.find((person) => person.name === "Noa");

    expect(noa?.stated_preferences).toEqual({});
    expect(payload).not.toContain("no preference");
  });

  it("tells the model to copy the ids back rather than tidy them", () => {
    expect(buildPayload(inputFor([NEAR]))).toContain(
      "Copy venue_id and slot_id"
    );
  });
});

/* --------------------------------------------------------------- the slot key */

describe("slot ids", () => {
  it("names the same slot the same way every time", () => {
    expect(slotId(THURSDAY)).toBe(slotId({ ...THURSDAY }));
  });

  it("separates two slots that start together and end apart", () => {
    const shorter = {
      start: THURSDAY.start,
      end: new Date("2026-09-10T19:00:00.000Z"),
    };
    expect(slotId(shorter)).not.toBe(slotId(THURSDAY));
  });

  it("keys a pair by both halves, because one venue at two hours is two choices", () => {
    const later = {
      start: THURSDAY.end,
      end: new Date("2026-09-10T22:00:00.000Z"),
    };
    expect(pairId("place-near", THURSDAY)).not.toBe(
      pairId("place-near", later)
    );
  });
});

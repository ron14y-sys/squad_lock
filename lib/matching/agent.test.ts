import { describe, expect, expectTypeOf, it } from "vitest";

import type { ProposalDTO } from "@/lib/db/meeting-detail";

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
    reason?: string;
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
        reason: option.reason ?? "קרוב לרוטשילד, והמקום מקפיד על האלרגיה.",
      })),
      traded_away:
        option.traded ?? "Yoav walks a little further than he would to Near.",
    })),
  });
}

/**
 * The payload's people and pairs, parsed. Each JSON block sits under a heading
 * line between blank lines, and `JSON.stringify` never writes a blank line.
 */
function parsePayload(payload: string) {
  type Row = Record<string, unknown>;
  const [people, pairs] = payload
    .split("\n\n")
    .slice(1, 3)
    .map((block) => JSON.parse(block.slice(block.indexOf("\n") + 1)) as Row[]);
  return {
    people: Object.fromEntries(people.map((person) => [person.name, person])),
    pairs,
  };
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

  it("carries both ends of the slot, not just the start", () => {
    // B6 shortens a meeting to fit a venue's opening hours, so the end is a
    // real answer rather than one implied by the group's free window — eval
    // scenario 07's expected answer is "until midnight, because the bar shuts".
    const draft = interpretAnswer(
      answer([{ rank: 1, venue: "place-near" }]),
      inputFor([NEAR])
    );

    expect(draft.options[0].proposedDatetime).toEqual(THURSDAY.start);
    expect(draft.options[0].proposedEnd).toEqual(THURSDAY.end);
  });

  it("looks a slot up in what was offered, not in the group's raw window", () => {
    // The two used to be separate lists that happened to agree. B6 separates
    // them: a trimmed slot is in `viable` and not in the group's availability,
    // and looking up the wrong list would reject the agent's correct answer as
    // "a slot that was not offered" — blaming the model for a time this file
    // put in the prompt.
    const input = inputFor([NEAR]);
    const trimmed = {
      start: THURSDAY.start,
      end: new Date(THURSDAY.end.getTime() - 30 * 60_000),
    };

    const draft = interpretAnswer(
      answer([{ rank: 1, venue: "place-near", slot: slotId(trimmed) }]),
      {
        ...input,
        // what B6 will hand over: a pair whose slot is narrower than the
        // window the group was free for.
        viable: [
          { candidatePlaceId: "place-near", slot: trimmed, unverified: [] },
        ],
      }
    );

    expect(draft.options[0].proposedEnd).toEqual(trimmed.end);
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
    // A6: and never reaches the meeting screen. Checked by `tsc`.
    expectTypeOf<ProposalDTO>().not.toHaveProperty("tradeoffs");
    expectTypeOf<ProposalDTO>().not.toHaveProperty("tradedAway");
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

  it("accepts a Hebrew justification that names a venue in Latin letters", () => {
    const venue = candidate("place-long", "The Norman Rooftop Bar", ROTHSCHILD);
    const reason = "The Norman Rooftop Bar, קרוב לבית.";

    expect(() =>
      interpretAnswer(
        answer([{ rank: 1, venue: "place-long", reason }]),
        inputFor([venue])
      )
    ).not.toThrow();
  });

  it("rejects an answer covering 5 of 6 participants, and accepts all 6", () => {
    const six = ["1", "2", "3", "4", "5", "6"].map((n) =>
      participant(`u-${n}`, `P${n}`)
    );
    const covering = (people: string[]) =>
      answer([{ rank: 1, venue: "place-near", people }]);
    const ids = six.map((p) => p.userId);

    expect(() =>
      interpretAnswer(covering(ids.slice(0, 5)), inputFor([NEAR], six))
    ).toThrow(/no justification for u-6/);
    expect(() =>
      interpretAnswer(covering(ids), inputFor([NEAR], six))
    ).not.toThrow();
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
    {
      rule: "a participant left out",
      options: [{ rank: 1, venue: "place-near", people: ["u-dana"] }],
      pool: [NEAR],
      throws: /no justification for u-yoav/,
    },
    {
      rule: "a participant left out of rank 3 only",
      options: [
        { rank: 1, venue: "place-near" },
        { rank: 2, venue: "place-middle" },
        { rank: 3, venue: "place-far", people: ["u-dana"] },
      ],
      pool: [NEAR, MIDDLE, FAR],
      throws: /rank 3 has no justification/,
    },
    {
      // A6: every reason is read on a Hebrew screen.
      rule: "a justification written in English",
      options: [
        {
          rank: 1,
          venue: "place-near",
          reason: "A short trip from Rothschild, and the place is kosher.",
        },
      ],
      pool: [NEAR],
      throws: /other than Hebrew/,
    },
    {
      rule: "an English sentence that only borrows a Hebrew word",
      options: [
        {
          rank: 1,
          venue: "place-near",
          reason: "Close to home, and the place is כשר.",
        },
      ],
      pool: [NEAR],
      throws: /other than Hebrew/,
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

    expect(parsePayload(payload).people.Noa.stated_preferences).toEqual({});
    expect(payload).not.toContain("no preference");
  });

  it("gives the model each person's needs and lost travel modes to name (A6)", () => {
    const adi = participant("u-adi", "Adi", ROTHSCHILD, {
      hardConstraints: { dietary: ["kosher"], allergies: [], unavailable: [] },
      recurringMobilityRules: [
        { kind: "mode_unavailable", weekdays: ["thursday"], mode: "car" },
      ],
    });
    const { people, pairs } = parsePayload(
      buildPayload(inputFor([NEAR], [adi, YOAV]))
    );

    expect(people.Adi.dietary_needs).toEqual(["kosher"]);
    expect(pairs[0].modes_unavailable_during_slot).toEqual({ Adi: ["car"] });
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

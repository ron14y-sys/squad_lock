import { beforeEach, describe, expect, it, vi } from "vitest";

import { runStageOf } from "@/lib/db/meeting-cards";

import { runCycle, runDueMeetings, type BusyLookup } from "./run-cycle";

/**
 * #155: a run writes each stage onto the meeting as it enters it, and leaves
 * none behind when it ends. The database is a recording stand-in, so what is
 * checked is the sequence of writes `runCycle` makes — the order a polling
 * screen would see them in. That Postgres accepts the column is the
 * migration's job, checked against a real database before merging.
 */

const updateMany = vi.fn();
const userUpdateMany = vi.fn();
const findMany = vi.fn();

vi.mock("@/lib/db/client", () => ({
  getPrisma: () => ({
    meeting: { findUnique: async () => meetingRow, updateMany, findMany },
    user: { updateMany: userUpdateMany },
    $transaction: async (fn: (tx: unknown) => unknown) => fn({}),
  }),
}));

// Where a finished run's draft is handed over to be written — captured, so
// a test can read what would have been stored.
const persistMatchRun = vi.fn();
vi.mock("@/lib/db/match-run", () => ({
  persistMatchRun: (...args: unknown[]) => persistMatchRun(...args),
}));

const HOME = { lat: 32.0853, lng: 34.7818 };

const NEXT_DOOR = {
  placeId: "p1",
  name: "Next door",
  address: null,
  location: HOME,
  neighbourhood: null,
};

// Called as (centre, radius, includedTypes); a test may answer by the types.
const searchNeighbourhoodCached = vi.fn();
vi.mock("@/lib/db/places-cache", () => ({
  searchNeighbourhoodCached: (...args: unknown[]) =>
    searchNeighbourhoodCached(...args),
  // Open every evening, bar the one a test names as shut (#212): two hours
  // in the early morning, which is less than a meeting needs.
  fetchPlaceDetailsCached: async (placeId: string) => ({
    openingHours:
      placeId === "pinned-shut"
        ? [{ weekdays: [], from: "06:00", to: "08:00" }]
        : [{ weekdays: [], from: "18:00", to: "23:00" }],
    servesVegetarianFood: true,
  }),
}));

// #212: resolving the words an initiator typed into a place. Everything else
// in the client stays real.
const findPlaceByText = vi.fn();
vi.mock("@/lib/places/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/places/client")>()),
  findPlaceByText: (...args: unknown[]) => findPlaceByText(...args),
}));

const runMatchingAgent = vi.fn();
vi.mock("./agent", () => ({
  runMatchingAgent: (...args: unknown[]) => runMatchingAgent(...args),
}));

const notifyCalendarReconnect = vi.fn();

vi.mock("@/lib/email/notify", () => ({
  notifyProposalWaiting: async () => {},
  notifyStuck: async () => {},
  notifyCalendarReconnect: (...args: unknown[]) =>
    notifyCalendarReconnect(...args),
}));

const STAMP = new Date("2026-09-30T09:00:00.000Z");
const NOW = new Date("2026-09-30T10:00:00.000Z");

const MEETING = {
  id: "m1",
  // Unpinned, one person, nobody busy: the case that reached production as
  // "a time slot longer than a week is not a slot" (see `searchWindow`).
  pinnedDate: null,
  occasion: null,
  responses: [
    {
      userId: "u1",
      status: "pending",
      user: {
        name: "Dana",
        preferenceProfile: {
          id: "pp1",
          userId: "u1",
          hardConstraints: {},
          softPreferences: {},
          homeLat: HOME.lat,
          homeLng: HOME.lng,
          homeNeighbourhood: null,
          toleranceKm: 5,
          recurringMobilityRules: [],
          createdAt: STAMP,
          updatedAt: STAMP,
        },
      },
    },
  ],
  participantContexts: [],
  matchRuns: [],
};

/** What `findUnique` hands back; a test may swap it for a variant of MEETING. */
let meetingRow: typeof MEETING = MEETING;

const FREE: BusyLookup = async (userIds) => ({
  busy: new Map(userIds.map((id) => [id, []])),
  unread: [],
  rejected: [],
});
const ALWAYS_BUSY: BusyLookup = async (userIds) => ({
  busy: new Map(
    userIds.map((id) => [
      id,
      [{ start: new Date("2026-09-01"), end: new Date("2026-12-01") }],
    ])
  ),
  unread: [],
  rejected: [],
});
/** u1's calendar was never connected. */
const UNCONNECTED: BusyLookup = async (userIds) => ({
  busy: new Map(),
  unread: userIds,
  rejected: [],
});
/** Google refused u1's token. */
const REJECTED: BusyLookup = async (userIds) => ({
  busy: new Map(),
  unread: userIds,
  rejected: userIds,
});

/** The `runStage` of every write, in order; `undefined` for writes that set something else. */
function stagesWritten() {
  return updateMany.mock.calls.map(([args]) => args.data.runStage);
}

beforeEach(() => {
  updateMany.mockReset().mockResolvedValue({ count: 1 });
  userUpdateMany.mockReset().mockResolvedValue({ count: 1 });
  findMany.mockReset();
  notifyCalendarReconnect.mockReset();
  runMatchingAgent.mockReset();
  searchNeighbourhoodCached.mockReset().mockResolvedValue([NEXT_DOOR]);
  findPlaceByText.mockReset().mockResolvedValue(null);
  persistMatchRun.mockReset().mockRejectedValue(new Error("not under test"));
  meetingRow = MEETING;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("runCycle's stage", () => {
  it("names each stage in order, then clears it when the run fails", async () => {
    runMatchingAgent.mockRejectedValue(new Error("model timed out"));

    await runCycle("m1", NOW, FREE);

    expect(runMatchingAgent).toHaveBeenCalledOnce();
    expect(stagesWritten()).toEqual([
      "calendars",
      "places",
      "venue_details",
      "model",
      null,
    ]);
  });

  it("marks only a meeting that is still weighing", async () => {
    runMatchingAgent.mockRejectedValue(new Error("model timed out"));

    await runCycle("m1", NOW, FREE);

    const [first] = updateMany.mock.calls[0];
    expect(first.where).toEqual({ id: "m1", status: "weighing" });
  });

  it("clears it when there is no evening to offer", async () => {
    await runCycle("m1", NOW, ALWAYS_BUSY);

    // `calendars`, then the clear, then the move to `stuck`.
    expect(stagesWritten()).toEqual(["calendars", null, undefined]);
    expect(updateMany.mock.calls[2][0].data).toEqual({ status: "stuck" });
    expect(runMatchingAgent).not.toHaveBeenCalled();
  });

  it("keeps running when a stage cannot be written", async () => {
    updateMany.mockRejectedValue(new Error("connection reset"));
    runMatchingAgent.mockRejectedValue(new Error("model timed out"));

    await runCycle("m1", NOW, FREE);

    // Every stage was still attempted, and the run reached the model.
    expect(runMatchingAgent).toHaveBeenCalledOnce();
    expect(stagesWritten().slice(0, 4)).toEqual([
      "calendars",
      "places",
      "venue_details",
      "model",
    ]);
  });

  it("B10: clears the rejected user's token, notifies them, and runs on", async () => {
    runMatchingAgent.mockRejectedValue(new Error("model timed out"));

    await runCycle("m1", NOW, REJECTED);

    expect(userUpdateMany).toHaveBeenCalledWith({
      where: { id: "u1", googleRefreshToken: { not: null } },
      data: { googleRefreshToken: null },
    });
    expect(notifyCalendarReconnect).toHaveBeenCalledWith("u1");
    // A refused calendar no longer holds the meeting: the run reaches the
    // model, with u1 treated as free.
    expect(runMatchingAgent).toHaveBeenCalledOnce();
  });

  it("B10: sends no second email when the token was already cleared", async () => {
    userUpdateMany.mockResolvedValue({ count: 0 });
    runMatchingAgent.mockRejectedValue(new Error("model timed out"));

    await runCycle("m1", NOW, REJECTED);

    expect(notifyCalendarReconnect).not.toHaveBeenCalled();
  });
});

describe("tonight's distance and start (#220)", () => {
  it("weighs this meeting with the person's own tolerance and earliest start for it", async () => {
    runMatchingAgent.mockRejectedValue(new Error("model timed out"));
    meetingRow = {
      ...MEETING,
      participantContexts: [
        {
          id: "ctx-1",
          meetingId: "m1",
          userId: "u1",
          originLat: null,
          originLng: null,
          originLabel: null,
          mobilityWindows: [],
          softPreferences: null,
          rejectionText: "רחוק לי מדי, ורק אחרי שמונה",
          rejectionOutcome: "distance",
          toleranceKm: 2,
          earliestStart: "20:00",
          latestStart: null,
          untranslated: null,
          note: null,
          createdAt: STAMP,
        },
      ],
    } as unknown as typeof MEETING;

    await runCycle("m1", NOW, FREE);

    const [input] = runMatchingAgent.mock.calls[0];
    // The profile said 5 km; tonight said 2.
    expect(input.participants[0].profile.toleranceKm).toBe(2);
    // Busy until 20:00 local (17:00Z) on the meeting's days.
    expect(
      input.participants[0].busy.some((block: { end: Date }) =>
        block.end.toISOString().endsWith("T17:00:00.000Z")
      )
    ).toBe(true);
  });
});

describe("what people asked for (#221)", () => {
  const venue = (placeId: string, types: string[], east = 0) => ({
    placeId,
    name: placeId,
    address: null,
    location: { lat: HOME.lat, lng: HOME.lng + east },
    neighbourhood: null,
    types,
  });
  const BAR = venue("bar", ["bar"], 0.001);
  const ANOTHER_BAR = venue("another-bar", ["pub", "bar"], 0.002);
  const RESTAURANT = venue("restaurant", ["restaurant"], 0.003);
  const BAR_WITH_FOOD = venue("bar-with-food", ["bar", "restaurant"], 0.004);

  /** The base search answers `base`; the one asking for bars, `bars`. */
  function searchReturns(base: unknown[], bars: unknown[]) {
    searchNeighbourhoodCached.mockImplementation(
      async (_centre: unknown, _radius: unknown, types?: string[]) =>
        types?.includes("pub") ? bars : base
    );
  }

  /** u1 said this tonight, in a rejection. */
  function askedTonight(softPreferences: object) {
    meetingRow = {
      ...MEETING,
      participantContexts: [
        {
          id: "ctx-1",
          meetingId: "m1",
          userId: "u1",
          originLat: null,
          originLng: null,
          originLabel: null,
          mobilityWindows: [],
          softPreferences,
          rejectionText: "בא לי בר",
          rejectionOutcome: "soft",
          toleranceKm: null,
          earliestStart: null,
          latestStart: null,
          untranslated: null,
          note: null,
          createdAt: STAMP,
        },
      ],
    } as unknown as typeof MEETING;
  }

  /** u1's profile lists these. */
  function prefers(softPreferences: object) {
    const [response] = MEETING.responses;
    meetingRow = {
      ...MEETING,
      responses: [
        {
          ...response,
          user: {
            ...response.user,
            preferenceProfile: {
              ...response.user.preferenceProfile,
              softPreferences,
            },
          },
        },
      ],
    } as unknown as typeof MEETING;
  }

  async function candidatesSent() {
    await runCycle("m1", NOW, FREE);
    const [input] = runMatchingAgent.mock.calls[0];
    return input.candidates.map((c: { placeId: string }) => c.placeId).sort();
  }

  function typesSearched() {
    return searchNeighbourhoodCached.mock.calls.map(([, , types]) => types);
  }

  beforeEach(() => {
    runMatchingAgent.mockRejectedValue(new Error("stop here"));
  });

  it("searches for a bar asked for tonight, and offers only bars", async () => {
    askedTonight({ venueKinds: ["bar"] });
    searchReturns([RESTAURANT, BAR], [ANOTHER_BAR]);

    expect(await candidatesSent()).toEqual(["another-bar", "bar"]);
    expect(typesSearched()).toContainEqual(
      expect.arrayContaining(["bar", "pub", "wine_bar"])
    );
  });

  it("adds what a profile prefers to the pool, without narrowing it", async () => {
    prefers({ venueKinds: ["bar"] });
    searchReturns([RESTAURANT], [BAR]);

    expect(await candidatesSent()).toEqual(["bar", "restaurant"]);
  });

  it("makes no second search when nobody wants anything in particular", async () => {
    searchReturns([RESTAURANT], [BAR]);

    expect(await candidatesSent()).toEqual(["restaurant"]);
    expect(typesSearched().every((types) => types === undefined)).toBe(true);
  });

  it("offers something else when nothing answers, and says so on every option", async () => {
    askedTonight({ venueKinds: ["bar"] });
    searchReturns([RESTAURANT], []);
    runMatchingAgent.mockResolvedValue({
      draft: {
        options: [
          { rank: 1, unverified: [] },
          { rank: 2, unverified: [] },
        ],
      },
      call: {},
    });

    await runCycle("m1", NOW, FREE);

    const [input] = runMatchingAgent.mock.calls[0];
    expect(input.candidates.map((c: { placeId: string }) => c.placeId)).toEqual(
      ["restaurant"]
    );
    const [draft] = persistMatchRun.mock.calls[0];
    for (const option of draft.options) {
      expect(option.unverified).toEqual([
        { kind: "unmet_request", venueKinds: ["bar"], cuisines: [] },
      ]);
    }
  });

  it("keeps a bar that serves food when the same person avoided restaurants", async () => {
    askedTonight({ venueKinds: ["bar"], avoidVenueKinds: ["restaurant"] });
    searchReturns([RESTAURANT, BAR_WITH_FOOD], []);

    expect(await candidatesSent()).toEqual(["bar-with-food"]);
  });
});

describe("a calendar that was not read", () => {
  const DRAFT = {
    options: [
      { rank: 1, unverified: [{ kind: "opening_hours" }] },
      { rank: 2, unverified: [] },
    ],
  };

  it("does not stop the run, and is stored on every option as unchecked", async () => {
    runMatchingAgent.mockResolvedValue({
      draft: structuredClone(DRAFT),
      call: {},
    });

    await runCycle("m1", NOW, UNCONNECTED);

    expect(persistMatchRun).toHaveBeenCalledOnce();
    const [draft] = persistMatchRun.mock.calls[0];
    expect(draft.options[0].unverified).toEqual([
      { kind: "opening_hours" },
      { kind: "calendar", userId: "u1" },
    ]);
    expect(draft.options[1].unverified).toEqual([
      { kind: "calendar", userId: "u1" },
    ]);
  });

  it("adds nothing when every calendar was read", async () => {
    runMatchingAgent.mockResolvedValue({
      draft: structuredClone(DRAFT),
      call: {},
    });

    await runCycle("m1", NOW, FREE);

    const [draft] = persistMatchRun.mock.calls[0];
    expect(draft.options).toEqual(DRAFT.options);
  });

  it("passes Google's vegetarian answer on to the filter and the model", async () => {
    runMatchingAgent.mockRejectedValue(new Error("model timed out"));

    await runCycle("m1", NOW, FREE);

    const [input] = runMatchingAgent.mock.calls[0];
    expect(input.venueFacts?.p1?.satisfies).toContain("צמחוני");
  });

  it("is not shown to the model", async () => {
    runMatchingAgent.mockRejectedValue(new Error("model timed out"));

    await runCycle("m1", NOW, UNCONNECTED);

    const [input] = runMatchingAgent.mock.calls[0];
    expect(JSON.stringify(input)).not.toContain('"calendar"');
    // Free as far as the calendar goes.
    expect(input.participants[0].busy).toEqual([]);
  });
});

describe("runDueMeetings", () => {
  // B11: the candidate query used to only ask for an unseen *rejection*
  // (`NOT: { rejectionText: null }`). A meeting whose only unseen context
  // row is a pure amendment -- both `rejectionText` and `softPreferences`
  // null -- must be picked up the same way, once its batch window has
  // passed. The mock only controls what the query *returns*, so this is
  // really asserting the shape `runDueMeetings` asks for, indirectly:
  // nothing here filters by kind, so an amendment-only row reaching
  // `isDue` at all means the real query (dropped filter) would surface it.
  it("B11: claims a meeting whose only unanswered row is an amendment", async () => {
    const old = new Date(NOW.getTime() - 10 * 60_000); // past every timer
    findMany.mockResolvedValueOnce([
      {
        id: "m1",
        updatedAt: old,
        retryNotBefore: null,
        matchRuns: [{ createdAt: old }],
        participantContexts: [{ createdAt: old }],
      },
    ]);

    await runDueMeetings("group-1", NOW);

    // The claim is `runDueMeetings`'s own commitment that this meeting is
    // due -- reaching it at all proves `isDue` said yes for a row with no
    // `rejectionText`, which only the generalized query makes possible.
    // What happens inside the run from here (`runCycle`'s own calendar
    // step, untouched by this mock) is not this test's concern.
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "m1", status: "weighing", updatedAt: old },
      data: { status: "weighing" },
    });
  });

  it("leaves a meeting alone when its only unanswered row is too recent", async () => {
    findMany.mockResolvedValueOnce([
      {
        id: "m1",
        updatedAt: new Date(NOW.getTime() - 10 * 60_000),
        retryNotBefore: null,
        matchRuns: [{ createdAt: new Date(NOW.getTime() - 10 * 60_000) }],
        participantContexts: [{ createdAt: new Date(NOW.getTime() - 1000) }],
      },
    ]);

    await runDueMeetings("group-1", NOW);

    expect(updateMany).not.toHaveBeenCalled();
    expect(runMatchingAgent).not.toHaveBeenCalled();
  });
});

describe("a group of one, free all week, with no date pinned", () => {
  it("is weighed as far as the model", async () => {
    runMatchingAgent.mockRejectedValue(new Error("stop here"));

    await runCycle("m1", NOW, FREE);

    expect(runMatchingAgent).toHaveBeenCalledOnce();
    expect(console.error).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ message: expect.stringMatching(/week/) })
    );
  });
});

describe("runStageOf", () => {
  it("shows the stage while the meeting is weighing", () => {
    expect(runStageOf({ status: "weighing", runStage: "model" })).toBe("model");
  });

  it("hides a stage left behind once the meeting has moved on", () => {
    for (const status of [
      "awaiting",
      "stuck",
      "closed",
      "cancelled",
    ] as const) {
      expect(runStageOf({ status, runStage: "model" })).toBeNull();
    }
  });
});

describe("a venue the initiator named (#212)", () => {
  const place = (placeId: string, north = 0.001) => ({
    placeId,
    name: "Bar Ha'Ir",
    address: null,
    location: { lat: HOME.lat + north, lng: HOME.lng },
    neighbourhood: null,
    types: ["bar"],
  });

  function named(text: string | null) {
    meetingRow = { ...MEETING, pinnedVenue: text } as unknown as typeof MEETING;
  }

  /** What the model would answer, so a run reaches the write. */
  function modelAnswers() {
    runMatchingAgent.mockResolvedValue({
      draft: {
        options: [
          { rank: 1, unverified: [] },
          { rank: 2, unverified: [] },
        ],
      },
      call: {},
    });
  }

  function unverifiedWritten() {
    const [draft] = persistMatchRun.mock.calls[0];
    return draft.options.map((o: { unverified: unknown[] }) => o.unverified);
  }

  it("looks the typed name up near the group, and weighs it though the neighbourhood search never returned it", async () => {
    named("Bar Ha'Ir");
    findPlaceByText.mockResolvedValue(place("pinned"));
    runMatchingAgent.mockRejectedValue(new Error("stop here"));

    await runCycle("m1", NOW, FREE);

    expect(findPlaceByText).toHaveBeenCalledWith("Bar Ha'Ir", {
      lat: HOME.lat,
      lng: HOME.lng,
    });
    const [input] = runMatchingAgent.mock.calls[0];
    expect(
      input.candidates.map((c: { placeId: string }) => c.placeId).sort()
    ).toEqual(["p1", "pinned"]);
  });

  it("tells the model to rank it first, and says nothing was missed on the proposal", async () => {
    named("Bar Ha'Ir");
    findPlaceByText.mockResolvedValue(place("pinned"));
    modelAnswers();

    await runCycle("m1", NOW, FREE);

    const [input] = runMatchingAgent.mock.calls[0];
    expect(input.pinnedVenue).toEqual({
      placeId: "pinned",
      name: "Bar Ha'Ir",
    });
    expect(unverifiedWritten()).toEqual([[], []]);
  });

  it("does not look anything up when no venue was named, or only spaces", async () => {
    runMatchingAgent.mockRejectedValue(new Error("stop here"));

    for (const text of [null, "   "]) {
      named(text);
      await runCycle("m1", NOW, FREE);
    }

    expect(findPlaceByText).not.toHaveBeenCalled();
    for (const [input] of runMatchingAgent.mock.calls) {
      expect(input.pinnedVenue).toBeUndefined();
    }
  });

  it("says no such place was found, in the words that were typed, on every option", async () => {
    named("Bar Ha'Ir");
    findPlaceByText.mockResolvedValue(null);
    modelAnswers();

    await runCycle("m1", NOW, FREE);

    const [input] = runMatchingAgent.mock.calls[0];
    expect(input.pinnedVenue).toBeUndefined();
    const fact = {
      kind: "unmet_pinned_venue",
      venue: "Bar Ha'Ir",
      reason: "not_found",
    };
    expect(unverifiedWritten()).toEqual([[fact], [fact]]);
  });

  it("says it is too far when the group's travel rule cut it", async () => {
    named("Bar Ha'Ir");
    // About 22 km north of a person who will go 5.
    findPlaceByText.mockResolvedValue(place("pinned-far", 0.2));
    modelAnswers();

    await runCycle("m1", NOW, FREE);

    const [input] = runMatchingAgent.mock.calls[0];
    expect(input.pinnedVenue).toBeUndefined();
    expect(input.candidates.map((c: { placeId: string }) => c.placeId)).toEqual(
      ["p1"]
    );
    const fact = {
      kind: "unmet_pinned_venue",
      venue: "Bar Ha'Ir",
      reason: "too_far",
    };
    expect(unverifiedWritten()).toEqual([[fact], [fact]]);
  });

  it("says it is unavailable when it is shut for every evening the group shares", async () => {
    named("Bar Ha'Ir");
    findPlaceByText.mockResolvedValue(place("pinned-shut"));
    modelAnswers();

    await runCycle("m1", NOW, FREE);

    const [input] = runMatchingAgent.mock.calls[0];
    expect(input.pinnedVenue).toBeUndefined();
    const fact = {
      kind: "unmet_pinned_venue",
      venue: "Bar Ha'Ir",
      reason: "unavailable",
    };
    expect(unverifiedWritten()).toEqual([[fact], [fact]]);
  });
});

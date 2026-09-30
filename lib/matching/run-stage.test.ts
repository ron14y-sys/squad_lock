import { beforeEach, describe, expect, it, vi } from "vitest";

import { runStageOf } from "@/lib/db/meeting-cards";

import { runCycle } from "./run-cycle";

/**
 * #155: a run writes each stage onto the meeting as it enters it, and leaves
 * none behind when it ends. The database is a recording stand-in, so what is
 * checked is the sequence of writes `runCycle` makes — the order a polling
 * screen would see them in. That Postgres accepts the column is the
 * migration's job, checked against a real database before merging.
 */

const updateMany = vi.fn();

vi.mock("@/lib/db/client", () => ({
  getPrisma: () => ({
    meeting: { findUnique: async () => MEETING, updateMany },
  }),
}));

const HOME = { lat: 32.0853, lng: 34.7818 };

vi.mock("@/lib/db/places-cache", () => ({
  searchNeighbourhoodCached: async () => [
    {
      placeId: "p1",
      name: "Next door",
      address: null,
      location: HOME,
      neighbourhood: null,
    },
  ],
  fetchPlaceDetailsCached: async () => ({
    openingHours: [{ weekdays: [], from: "18:00", to: "23:00" }],
  }),
}));

const runMatchingAgent = vi.fn();
vi.mock("./agent", () => ({
  runMatchingAgent: (...args: unknown[]) => runMatchingAgent(...args),
}));

vi.mock("@/lib/email/notify", () => ({
  notifyProposalWaiting: async () => {},
  notifyStuck: async () => {},
}));

const STAMP = new Date("2026-09-30T09:00:00.000Z");
const NOW = new Date("2026-09-30T10:00:00.000Z");

const MEETING = {
  id: "m1",
  // Pinned, so the window is one day. Unpinned with free calendars, the week is
  // one slot, which constraints.ts rejects as longer than a week.
  pinnedDate: new Date("2026-10-01T00:00:00.000Z"),
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

const FREE = async () => new Map();
const ALWAYS_BUSY = async (userIds: string[]) =>
  new Map(
    userIds.map((id) => [
      id,
      [{ start: new Date("2026-09-01"), end: new Date("2026-12-01") }],
    ])
  );

/** The `runStage` of every write, in order; `undefined` for writes that set something else. */
function stagesWritten() {
  return updateMany.mock.calls.map(([args]) => args.data.runStage);
}

beforeEach(() => {
  updateMany.mockReset().mockResolvedValue({ count: 1 });
  runMatchingAgent.mockReset();
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

import { describe, expect, it } from "vitest";

import type { MeetingStatus } from "@/lib/generated/prisma/enums";
import type { ViablePair } from "./constraints";
import type { CandidateScore } from "./distance";
import { visitedVenues, withoutVisited, type GroupMeeting } from "./recent";

const NOW = new Date("2026-10-11T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

function meeting(
  status: MeetingStatus,
  at: Date | null,
  ...runs: (string | null)[]
): GroupMeeting {
  return {
    status,
    currentDatetime: at,
    matchRuns: runs.map((venuePlaceId) => ({ options: [{ venuePlaceId }] })),
  };
}

describe("visitedVenues (#213)", () => {
  it("is the venue of each closed meeting, from 30 days ago on, future ones too", () => {
    const visited = visitedVenues(
      [
        meeting("closed", daysAgo(30), "a"),
        meeting("closed", daysAgo(-3), "b"),
        meeting("closed", daysAgo(31), "old"),
      ],
      NOW
    );
    expect([...visited]).toEqual(["a", "b"]);
  });

  it("counts no meeting that did not close", () => {
    const visited = visitedVenues(
      [
        meeting("awaiting", daysAgo(1), "a"),
        meeting("weighing", daysAgo(1), "b"),
        meeting("stuck", daysAgo(1), "c"),
        meeting("cancelled", daysAgo(1), "d"),
      ],
      NOW
    );
    expect(visited.size).toBe(0);
  });

  it("reads only the last run: the earlier ones were turned down", () => {
    const visited = visitedVenues(
      [meeting("closed", daysAgo(1), "rejected", "approved")],
      NOW
    );
    expect([...visited]).toEqual(["approved"]);
  });

  it("skips a venue that was never resolved to a place", () => {
    expect(visitedVenues([meeting("closed", daysAgo(1), null)], NOW).size).toBe(
      0
    );
  });
});

describe("withoutVisited (#213)", () => {
  const score = (placeId: string, worst: number) =>
    ({ candidate: { placeId }, leximin: [worst] }) as unknown as CandidateScore;
  const pair = (placeId: string) =>
    ({ candidatePlaceId: placeId }) as unknown as ViablePair;
  const ids = (result: ReturnType<typeof withoutVisited>) => [
    result.ranked.map((s) => s.candidate.placeId),
    result.viable.map((p) => p.candidatePlaceId),
  ];
  const visited = new Set(["been"]);

  it("drops a visited venue when another is within everyone's range (1.0 exactly)", () => {
    const result = withoutVisited(
      [score("been", 0.2), score("new", 1)],
      [pair("been"), pair("new")],
      visited,
      undefined
    );
    expect(ids(result)).toEqual([["new"], ["new"]]);
  });

  it("keeps it when every other venue is beyond someone's range", () => {
    const result = withoutVisited(
      [score("been", 0.2), score("new", 1.01)],
      [pair("been"), pair("new")],
      visited,
      undefined
    );
    expect(ids(result)).toEqual([
      ["been", "new"],
      ["been", "new"],
    ]);
  });

  it("never drops the venue it is told to keep", () => {
    const result = withoutVisited(
      [score("been", 0.2), score("new", 0.5)],
      [pair("been"), pair("new")],
      visited,
      "been"
    );
    expect(ids(result)).toEqual([
      ["been", "new"],
      ["been", "new"],
    ]);
  });
});

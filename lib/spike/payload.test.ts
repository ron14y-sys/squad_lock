import { describe, expect, it } from "vitest";
import { buildWorstCasePayload } from "./payload";

/**
 * The measurement is only worth something if the payload really is the worst
 * case. These guard that claim — if someone trims the payload later, the
 * recorded number in docs/decisions/runtime-budget.md stops meaning what it says.
 */
describe("worst-case matching payload", () => {
  const payload = buildWorstCasePayload();

  it("carries the largest realistic group", () => {
    expect(payload.participants).toHaveLength(6);
  });

  it("carries a full shortlist, at the top of the B7c range", () => {
    expect(payload.candidates.length).toBeGreaterThanOrEqual(20);
    expect(payload.candidates.length).toBeLessThanOrEqual(24);
  });

  it("is a cycle-3 run, so it carries a rejection history", () => {
    expect(payload.cycle).toBe(3);
    expect(payload.rejection_history.length).toBeGreaterThan(0);
  });

  it("gives every candidate a distance for every participant", () => {
    for (const candidate of payload.candidates) {
      expect(Object.keys(candidate.distances_km).sort()).toEqual(
        payload.participants.map((p) => p.id).sort()
      );
    }
  });

  it("is deterministic, so two measurements are comparable", () => {
    expect(JSON.stringify(buildWorstCasePayload())).toBe(
      JSON.stringify(payload)
    );
  });
});

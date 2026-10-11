import { beforeEach, describe, expect, it, vi } from "vitest";

import { straightLineKm } from "@/lib/matching/distance";

import { applyLabelledRejection } from "./apply-rejection";
import { CLOSER_FACTOR } from "./tonight-bounds";

const findRejectedOption = vi.fn();
const findTonightReach = vi.fn();
const recordRejectionOutcome = vi.fn();

vi.mock("@/lib/db/meetings", () => ({
  findRejectedOption: (...args: unknown[]) => findRejectedOption(...args),
  findTonightReach: (...args: unknown[]) => findTonightReach(...args),
  recordRejectionOutcome: (...args: unknown[]) =>
    recordRejectionOutcome(...args),
}));

// A7 is not called by a ticked rejection; if it were, this would show.
vi.mock("./constraint-updater", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./constraint-updater")>()),
  runConstraintUpdater: vi.fn(() => {
    throw new Error("the model must not be called for ticked reasons");
  }),
}));

const HOME = { lat: 32.0853, lng: 34.7818 };
const VENUE = { lat: HOME.lat + 0.04, lng: HOME.lng };
// 19:00 local (UTC+3 on this date).
const REJECTED = {
  venueName: "easy pizza",
  slot: {
    start: new Date("2026-10-18T16:00:00.000Z"),
    end: new Date("2026-10-18T20:00:00.000Z"),
  },
  location: VENUE,
};

beforeEach(() => {
  findRejectedOption.mockReset().mockResolvedValue(REJECTED);
  findTonightReach
    .mockReset()
    .mockResolvedValue({ origin: HOME, toleranceKm: 8 });
  recordRejectionOutcome.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("applyLabelledRejection", () => {
  it("records a disliked cuisine as a soft correction, with the sentence and no bounds", async () => {
    await applyLabelledRejection("m1", "u1", { cuisines: ["pizza"] });

    expect(recordRejectionOutcome).toHaveBeenCalledOnce();
    const [meetingId, userId, outcome, correction, text, bounds] =
      recordRejectionOutcome.mock.calls[0];
    expect(meetingId).toBe("m1");
    expect(userId).toBe("u1");
    expect(outcome).toBe("soft");
    expect(correction).toEqual({ avoidCuisines: ["pizza"] });
    expect(text).toBe("לא מתאים לי: סוג האוכל (פיצה)");
    expect(bounds).toEqual({
      toleranceKm: null,
      earliestStart: null,
      latestStart: null,
      untranslated: null,
    });
  });

  it("measures 'too far' against the rejected venue, as it does for a sentence", async () => {
    await applyLabelledRejection("m1", "u1", { tooFar: true });

    const [, , outcome, correction, , bounds] =
      recordRejectionOutcome.mock.calls[0];
    const away = straightLineKm(HOME, VENUE);
    expect(outcome).toBe("distance");
    expect(correction).toBeNull();
    expect(bounds.toleranceKm).toBe(
      Math.max(0.5, Math.round(Math.min(away, 8) * CLOSER_FACTOR * 10) / 10)
    );
    expect(bounds.toleranceKm).toBeLessThan(away);
  });

  it("turns a later suitable hour into 'not before' and records it as a time rejection", async () => {
    await applyLabelledRejection("m1", "u1", { suitableStart: "21:00" });

    const [, , outcome, , , bounds] = recordRejectionOutcome.mock.calls[0];
    expect(outcome).toBe("time");
    expect(bounds.earliestStart).toBe("21:00");
    expect(bounds.latestStart).toBeNull();
  });

  it("turns an earlier suitable hour into 'not after'", async () => {
    await applyLabelledRejection("m1", "u1", { suitableStart: "17:00" });

    const [, , , , , bounds] = recordRejectionOutcome.mock.calls[0];
    expect(bounds.latestStart).toBe("17:00");
    expect(bounds.earliestStart).toBeNull();
  });

  it("records nothing when no proposal was ever made", async () => {
    findRejectedOption.mockResolvedValue(null);

    await applyLabelledRejection("m1", "u1", { tooExpensive: true });

    expect(recordRejectionOutcome).not.toHaveBeenCalled();
  });

  it("never throws, and keeps the sentence as a failed call, which blocks no venue", async () => {
    recordRejectionOutcome
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce(undefined);

    await expect(
      applyLabelledRejection("m1", "u1", { tooExpensive: true })
    ).resolves.toBeUndefined();

    expect(recordRejectionOutcome).toHaveBeenCalledTimes(2);
    const [, , outcome, correction, text] =
      recordRejectionOutcome.mock.calls[1];
    expect(outcome).toBe("failed_call");
    expect(correction).toBeNull();
    expect(text).toBe("לא מתאים לי: יקר לי מדי");
  });
});

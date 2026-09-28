import { describe, expect, it } from "vitest";

import { MeetingStatus, ResponseStatus } from "@/lib/generated/prisma/client";
import { allStillInHaveApproved, transitionFlags } from "./meetings";

/**
 * `lib/db/meetings.ts` had no test file at all before B8's confirmation
 * work — `initiateMeeting` and `respondToMeeting` are both transactional,
 * DB-only functions with no injectable client, the same gap B5c's own
 * todo.md note names ("no test in this repo touches a real database").
 * This file does not close that gap in general; it covers the pure logic
 * that can be tested without one: `allStillInHaveApproved` (spec §3 step
 * 8, confirmation) and `transitionFlags` (B8 part two's `justClosed` /
 * `justStuck`, which decide whether `respondToMeeting`'s caller should
 * fire an email). `__tests__/meetings-confirmation-db.test.ts` proves the
 * transaction that reads `allStillInHaveApproved` actually closes a real
 * row; `transitionFlags` itself has no DB test of its own, deliberately —
 * see its own comment on why the pure version is the whole point.
 */

const approved = { status: ResponseStatus.approved };
const pending = { status: ResponseStatus.pending };
const cantMakeIt = { status: ResponseStatus.cant_make_it };
const doesntSuit = { status: ResponseStatus.doesnt_suit };

describe("allStillInHaveApproved", () => {
  it("is false for an empty response list — nobody to confirm anything for", () => {
    expect(allStillInHaveApproved([])).toBe(false);
  });

  it("is false when everyone dropped out — not a confirmation, not vacuously true", () => {
    expect(allStillInHaveApproved([cantMakeIt, cantMakeIt])).toBe(false);
  });

  it("is false while anyone still in is pending", () => {
    expect(allStillInHaveApproved([approved, pending])).toBe(false);
  });

  it("is false while anyone still in has rejected", () => {
    expect(allStillInHaveApproved([approved, doesntSuit])).toBe(false);
  });

  it("is true when everyone still in has approved", () => {
    expect(allStillInHaveApproved([approved, approved, approved])).toBe(true);
  });

  it("ignores anyone who dropped out — the last non-approver dropping out can complete the set", () => {
    expect(allStillInHaveApproved([approved, approved, cantMakeIt])).toBe(true);
  });

  it("is true for a single still-in participant who approved", () => {
    expect(allStillInHaveApproved([approved])).toBe(true);
  });
});

describe("transitionFlags", () => {
  it("justClosed is true only when the meeting just became closed", () => {
    expect(
      transitionFlags(MeetingStatus.awaiting, MeetingStatus.closed)
    ).toEqual({ justClosed: true, justStuck: false });
  });

  it("justClosed is false when the meeting stayed on the same status", () => {
    expect(
      transitionFlags(MeetingStatus.awaiting, MeetingStatus.awaiting)
    ).toEqual({ justClosed: false, justStuck: false });
  });

  it("justStuck is true only when the meeting just became stuck", () => {
    expect(
      transitionFlags(MeetingStatus.weighing, MeetingStatus.stuck)
    ).toEqual({ justClosed: false, justStuck: true });
  });

  it("justStuck is false when the meeting was already stuck — no re-fire on a later response", () => {
    expect(transitionFlags(MeetingStatus.stuck, MeetingStatus.stuck)).toEqual({
      justClosed: false,
      justStuck: false,
    });
  });

  it("is false for both when nothing terminal happened", () => {
    expect(
      transitionFlags(MeetingStatus.awaiting, MeetingStatus.weighing)
    ).toEqual({ justClosed: false, justStuck: false });
  });
});

import { describe, expect, it } from "vitest";

import { ResponseStatus } from "@/lib/generated/prisma/client";
import { allStillInHaveApproved } from "./meetings";

/**
 * `lib/db/meetings.ts` had no test file at all before this — `initiateMeeting`
 * and `respondToMeeting` are both transactional, DB-only functions with no
 * injectable client, the same gap B5c's own todo.md note names ("no test in
 * this repo touches a real database"). This file does not close that gap in
 * general; it covers only `allStillInHaveApproved`, the one piece of new
 * logic (spec §3 step 8, confirmation) that is pure and can be tested
 * without one. `__tests__/meetings-confirmation-db.test.ts` proves the
 * transaction that reads it actually closes a real row.
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

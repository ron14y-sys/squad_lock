import { describe, expect, it } from "vitest";

import { deriveMeetingCardStatus } from "./meeting-cards";

import type { Meeting, Response } from "@/lib/types/meeting";

function meeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: "meeting-1",
    groupId: "group-1",
    initiatorId: "user-initiator",
    status: "awaiting",
    cycleCount: 0,
    pinnedWhen: null,
    pinnedVenue: null,
    occasion: null,
    currentDatetime: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  };
}

function response(overrides: Partial<Response> = {}): Response {
  return {
    id: "response-1",
    meetingId: "meeting-1",
    userId: "user-viewer",
    status: "pending",
    reasonText: null,
    respondedAt: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("deriveMeetingCardStatus", () => {
  it("is closed once the meeting itself is closed", () => {
    const status = deriveMeetingCardStatus({
      meeting: meeting({ status: "closed" }),
      responses: [],
      viewerId: "user-viewer",
      hasConflict: false,
    });
    expect(status).toBe("closed");
  });

  it("treats a cancelled meeting the same as closed", () => {
    // Cancelled flips straight back to `weighing` in practice (see
    // cancelConflictingMeetings), but the stored value is still handled.
    const status = deriveMeetingCardStatus({
      meeting: meeting({ status: "cancelled" }),
      responses: [],
      viewerId: "user-viewer",
      hasConflict: false,
    });
    expect(status).toBe("closed");
  });

  it("puts conflicting ahead of stuck — spec §5.7 requires it be unmissable", () => {
    const status = deriveMeetingCardStatus({
      meeting: meeting({ status: "stuck" }),
      responses: [],
      viewerId: "user-viewer",
      hasConflict: true,
    });
    expect(status).toBe("conflicting");
  });

  it("puts conflicting ahead of an open, undecided meeting too", () => {
    const status = deriveMeetingCardStatus({
      meeting: meeting({ status: "awaiting" }),
      responses: [response({ status: "pending" })],
      viewerId: "user-viewer",
      hasConflict: true,
    });
    expect(status).toBe("conflicting");
  });

  it("is stuck when the meeting hit its cycle cap and nothing conflicts", () => {
    const status = deriveMeetingCardStatus({
      meeting: meeting({ status: "stuck" }),
      responses: [],
      viewerId: "user-viewer",
      hasConflict: false,
    });
    expect(status).toBe("stuck");
  });

  it("is re-weighing while the meeting is still being matched", () => {
    const status = deriveMeetingCardStatus({
      meeting: meeting({ status: "weighing" }),
      responses: [],
      viewerId: "user-viewer",
      hasConflict: false,
    });
    expect(status).toBe("reweighing");
  });

  it("is waiting_on_you when a proposal is out and the viewer hasn't responded", () => {
    const status = deriveMeetingCardStatus({
      meeting: meeting({ status: "awaiting" }),
      responses: [response({ userId: "user-viewer", status: "pending" })],
      viewerId: "user-viewer",
      hasConflict: false,
    });
    expect(status).toBe("waiting_on_you");
  });

  it("is waiting_on_you when the viewer has no response row at all", () => {
    const status = deriveMeetingCardStatus({
      meeting: meeting({ status: "awaiting" }),
      responses: [response({ userId: "someone-else", status: "pending" })],
      viewerId: "user-viewer",
      hasConflict: false,
    });
    expect(status).toBe("waiting_on_you");
  });

  it("is waiting_on_others once the viewer has approved and others haven't", () => {
    const status = deriveMeetingCardStatus({
      meeting: meeting({ status: "awaiting" }),
      responses: [
        response({ userId: "user-viewer", status: "approved" }),
        response({ userId: "someone-else", status: "pending" }),
      ],
      viewerId: "user-viewer",
      hasConflict: false,
    });
    expect(status).toBe("waiting_on_others");
  });

  it("is waiting_on_others once the viewer said they can't make it", () => {
    const status = deriveMeetingCardStatus({
      meeting: meeting({ status: "awaiting" }),
      responses: [
        response({ userId: "user-viewer", status: "cant_make_it" }),
        response({ userId: "someone-else", status: "pending" }),
      ],
      viewerId: "user-viewer",
      hasConflict: false,
    });
    expect(status).toBe("waiting_on_others");
  });
});

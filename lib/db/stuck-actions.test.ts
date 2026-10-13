import { beforeEach, describe, expect, it, vi } from "vitest";

import { MeetingStatus } from "@/lib/generated/prisma/client";

const prisma = vi.hoisted(() => ({
  meeting: { findUnique: vi.fn(), update: vi.fn() },
  groupMember: { findUnique: vi.fn() },
}));
vi.mock("./client", () => ({ getPrisma: () => prisma }));

const { NotTheInitiatorError, MeetingNotStuckError, cancelStuckMeeting } =
  await import("./stuck-actions");
const { NotAMeetingParticipantError } = await import("./meetings");

function stuckMeeting(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    groupId: "g1",
    initiatorId: "initiator",
    status: MeetingStatus.stuck,
    responses: [{ id: "r1" }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("cancelStuckMeeting", () => {
  it("lets the initiator cancel without asking about membership", async () => {
    prisma.meeting.findUnique.mockResolvedValue(stuckMeeting());

    await cancelStuckMeeting("initiator", "m1");

    expect(prisma.meeting.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { status: MeetingStatus.cancelled },
    });
    expect(prisma.groupMember.findUnique).not.toHaveBeenCalled();
  });

  it("refuses another member while the initiator is still in the group", async () => {
    prisma.meeting.findUnique.mockResolvedValue(stuckMeeting());
    prisma.groupMember.findUnique.mockResolvedValue({ id: "gm1" });

    await expect(cancelStuckMeeting("other", "m1")).rejects.toThrow(
      NotTheInitiatorError
    );
    expect(prisma.meeting.update).not.toHaveBeenCalled();
  });

  it("lets another member cancel once the initiator has left the group", async () => {
    prisma.meeting.findUnique.mockResolvedValue(stuckMeeting());
    prisma.groupMember.findUnique.mockResolvedValue(null);

    await cancelStuckMeeting("other", "m1");

    expect(prisma.groupMember.findUnique).toHaveBeenCalledWith({
      where: { groupId_userId: { groupId: "g1", userId: "initiator" } },
      select: { id: true },
    });
    expect(prisma.meeting.update).toHaveBeenCalledOnce();
  });

  it("still needs a meeting that is stuck, and a participant", async () => {
    prisma.meeting.findUnique.mockResolvedValueOnce(
      stuckMeeting({ status: MeetingStatus.awaiting })
    );
    await expect(cancelStuckMeeting("initiator", "m1")).rejects.toThrow(
      MeetingNotStuckError
    );

    prisma.meeting.findUnique.mockResolvedValueOnce(
      stuckMeeting({ responses: [] })
    );
    await expect(cancelStuckMeeting("stranger", "m1")).rejects.toThrow(
      NotAMeetingParticipantError
    );
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import { MeetingStatus } from "@/lib/generated/prisma/client";

const prisma = vi.hoisted(() => ({
  meeting: { findUnique: vi.fn() },
  meetingHide: { upsert: vi.fn() },
}));
vi.mock("./client", () => ({ getPrisma: () => prisma }));

const { MeetingNotOverError, canHideMeeting, hideMeeting } =
  await import("./meeting-hides");
const { NotAMeetingParticipantError } = await import("./meetings");

const NOW = new Date("2026-10-13T12:00:00.000Z").getTime();
const PAST = new Date("2026-10-12T18:00:00.000Z");
const FUTURE = new Date("2026-10-15T18:00:00.000Z");

beforeEach(() => {
  vi.resetAllMocks();
});

describe("canHideMeeting", () => {
  it("is true for a closed or a cancelled meeting, whatever its date", () => {
    expect(
      canHideMeeting(
        { status: MeetingStatus.closed, currentDatetime: FUTURE },
        NOW
      )
    ).toBe(true);
    expect(
      canHideMeeting(
        { status: MeetingStatus.cancelled, currentDatetime: null },
        NOW
      )
    ).toBe(true);
  });

  it("is true once the date has passed, even if nobody closed it", () => {
    expect(
      canHideMeeting(
        { status: MeetingStatus.awaiting, currentDatetime: PAST },
        NOW
      )
    ).toBe(true);
  });

  it("is false for a meeting that is still going", () => {
    expect(
      canHideMeeting(
        { status: MeetingStatus.awaiting, currentDatetime: FUTURE },
        NOW
      )
    ).toBe(false);
    expect(
      canHideMeeting(
        { status: MeetingStatus.weighing, currentDatetime: null },
        NOW
      )
    ).toBe(false);
    expect(
      canHideMeeting(
        { status: MeetingStatus.stuck, currentDatetime: null },
        NOW
      )
    ).toBe(false);
  });
});

describe("hideMeeting", () => {
  function row(overrides: Record<string, unknown> = {}) {
    return {
      status: MeetingStatus.closed,
      currentDatetime: PAST,
      responses: [{ id: "r1" }],
      ...overrides,
    };
  }

  it("records the hide for this user and this meeting only", async () => {
    prisma.meeting.findUnique.mockResolvedValue(row());

    await hideMeeting("u1", "m1");

    expect(prisma.meetingHide.upsert).toHaveBeenCalledWith({
      where: { userId_meetingId: { userId: "u1", meetingId: "m1" } },
      update: {},
      create: { userId: "u1", meetingId: "m1" },
    });
  });

  it("answers a stranger as it would for a meeting that does not exist", async () => {
    prisma.meeting.findUnique.mockResolvedValue(row({ responses: [] }));
    await expect(hideMeeting("u2", "m1")).rejects.toThrow(
      NotAMeetingParticipantError
    );

    prisma.meeting.findUnique.mockResolvedValue(null);
    await expect(hideMeeting("u1", "nope")).rejects.toThrow(
      NotAMeetingParticipantError
    );
    expect(prisma.meetingHide.upsert).not.toHaveBeenCalled();
  });

  it("refuses a meeting that is still going", async () => {
    prisma.meeting.findUnique.mockResolvedValue(
      row({ status: MeetingStatus.awaiting, currentDatetime: FUTURE })
    );

    await expect(hideMeeting("u1", "m1")).rejects.toThrow(MeetingNotOverError);
    expect(prisma.meetingHide.upsert).not.toHaveBeenCalled();
  });
});

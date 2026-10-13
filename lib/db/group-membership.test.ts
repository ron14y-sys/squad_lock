import { beforeEach, describe, expect, it, vi } from "vitest";

import { MeetingStatus } from "@/lib/generated/prisma/client";
import { NotificationKind } from "@/lib/generated/prisma/enums";

const respondToMeeting = vi.hoisted(() => vi.fn());
vi.mock("./meetings", async (original) => ({
  ...(await original<object>()),
  respondToMeeting,
}));

const tx = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  groupMember: { findMany: vi.fn(), delete: vi.fn(), update: vi.fn() },
  invitation: { deleteMany: vi.fn() },
  response: { deleteMany: vi.fn() },
  meeting: { updateMany: vi.fn() },
  group: { findUniqueOrThrow: vi.fn() },
  notification: { createMany: vi.fn() },
}));
const prisma = vi.hoisted(() => ({
  groupMember: { findMany: vi.fn() },
  meeting: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("./client", () => ({ getPrisma: () => prisma }));

const { LastMemberError, NotInGroupError, leaveGroup } =
  await import("./group-membership");
const { MeetingNotOpenError } = await import("./meetings");

const OPEN = [
  MeetingStatus.weighing,
  MeetingStatus.awaiting,
  MeetingStatus.stuck,
];

function member(id: string, isAdmin = false) {
  return {
    userId: id,
    isAdmin,
    user: { name: `name-${id}`, email: `${id}@Example.test` },
  };
}

/** The group as both the first look and the locked read see it. */
function groupOf(...members: ReturnType<typeof member>[]) {
  prisma.groupMember.findMany.mockResolvedValue(members);
  tx.groupMember.findMany.mockResolvedValue(members);
}

beforeEach(() => {
  vi.resetAllMocks();
  prisma.$transaction.mockImplementation(
    (work: (client: typeof tx) => unknown) => work(tx)
  );
  prisma.meeting.findMany.mockResolvedValue([]);
  tx.meeting.updateMany.mockResolvedValue({ count: 0 });
  tx.group.findUniqueOrThrow.mockResolvedValue({ name: "השישיה" });
});

describe("leaveGroup", () => {
  it("removes the member and their old invitation, and tells those who stay", async () => {
    groupOf(member("a", true), member("b"), member("c"), member("d"));

    await leaveGroup("d", "g1");

    expect(tx.groupMember.delete).toHaveBeenCalledWith({
      where: { groupId_userId: { groupId: "g1", userId: "d" } },
    });
    expect(tx.invitation.deleteMany).toHaveBeenCalledWith({
      where: {
        groupId: "g1",
        status: "accepted",
        OR: [
          { acceptedByUserId: "d" },
          { email: { equals: "d@Example.test", mode: "insensitive" } },
        ],
      },
    });
    expect(tx.notification.createMany).toHaveBeenCalledWith({
      data: ["a", "b", "c"].map((userId) => ({
        userId,
        kind: NotificationKind.member_left,
        groupId: "g1",
        groupName: "השישיה",
        actorName: "name-d",
      })),
    });
    expect(tx.meeting.updateMany).not.toHaveBeenCalled();
    expect(tx.groupMember.update).not.toHaveBeenCalled();
  });

  it("takes the lock on the group before reading who is in it", async () => {
    groupOf(member("a", true), member("b"), member("c"));
    const order: string[] = [];
    tx.$queryRaw.mockImplementation(async () => void order.push("lock"));
    tx.groupMember.findMany.mockImplementation(async () => {
      order.push("read");
      return [member("a", true), member("b"), member("c")];
    });

    await leaveGroup("c", "g1");

    expect(order).toEqual(["lock", "read"]);
  });

  it("passes the admin role to one of those who stay, and tells them", async () => {
    groupOf(member("a", true), member("b"), member("c"), member("d"));

    await leaveGroup("a", "g1", () => 0);

    expect(tx.groupMember.update).toHaveBeenCalledWith({
      where: { groupId_userId: { groupId: "g1", userId: "b" } },
      data: { isAdmin: true },
    });
    const { data } = tx.notification.createMany.mock.calls[0][0];
    expect(data).toContainEqual({
      userId: "b",
      kind: NotificationKind.became_admin,
      groupId: "g1",
      groupName: "השישיה",
    });
  });

  it("cancels the open meetings and says how many when the group falls below three", async () => {
    groupOf(member("a", true), member("b"), member("c"));
    tx.meeting.updateMany.mockResolvedValue({ count: 2 });

    await leaveGroup("c", "g1");

    expect(tx.meeting.updateMany).toHaveBeenCalledWith({
      where: { groupId: "g1", status: { in: OPEN } },
      data: { status: MeetingStatus.cancelled },
    });
    expect(tx.notification.createMany).toHaveBeenCalledWith({
      data: ["a", "b"].map((userId) => ({
        userId,
        kind: NotificationKind.group_inactive,
        groupId: "g1",
        groupName: "השישיה",
        actorName: "name-c",
        meetingsCancelled: 2,
      })),
    });
  });

  it("takes the leaver off the open meetings, and leaves the finished ones alone", async () => {
    groupOf(member("a", true), member("b"), member("c"), member("d"));

    await leaveGroup("d", "g1");

    expect(tx.response.deleteMany).toHaveBeenCalledWith({
      where: { userId: "d", meeting: { groupId: "g1", status: { in: OPEN } } },
    });
  });

  it("says can't-make-it in each open meeting first, and reports the ones that closed", async () => {
    groupOf(member("a", true), member("b"), member("c"), member("d"));
    prisma.meeting.findMany.mockResolvedValue([{ id: "m1" }, { id: "m2" }]);
    respondToMeeting
      .mockResolvedValueOnce({ justClosed: true })
      .mockResolvedValueOnce({ justClosed: false });

    const result = await leaveGroup("d", "g1");

    expect(respondToMeeting).toHaveBeenNthCalledWith(1, "m1", "d", {
      kind: "cant_make_it",
    });
    expect(respondToMeeting).toHaveBeenNthCalledWith(2, "m2", "d", {
      kind: "cant_make_it",
    });
    expect(result).toEqual({ closedMeetingIds: ["m1"] });
    // Before the membership goes, not after.
    expect(respondToMeeting.mock.invocationCallOrder[0]).toBeLessThan(
      tx.groupMember.delete.mock.invocationCallOrder[0]
    );
  });

  it("carries on when a meeting closed while it was working", async () => {
    groupOf(member("a", true), member("b"), member("c"), member("d"));
    prisma.meeting.findMany.mockResolvedValue([{ id: "m1" }, { id: "m2" }]);
    respondToMeeting
      .mockRejectedValueOnce(new MeetingNotOpenError("m1"))
      .mockResolvedValueOnce({ justClosed: false });

    await expect(leaveGroup("d", "g1")).resolves.toEqual({
      closedMeetingIds: [],
    });
    expect(tx.groupMember.delete).toHaveBeenCalledOnce();
  });

  it("turns the last member away before changing anything", async () => {
    groupOf(member("a", true));

    await expect(leaveGroup("a", "g1")).rejects.toThrow(LastMemberError);

    expect(respondToMeeting).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("turns a stranger away", async () => {
    groupOf(member("a", true), member("b"), member("c"));

    await expect(leaveGroup("z", "g1")).rejects.toThrow(NotInGroupError);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses inside the lock too, when somebody else left first", async () => {
    // The first look saw three; by the time this one has the lock, only the
    // leaver is left.
    prisma.groupMember.findMany.mockResolvedValue([
      member("a", true),
      member("b"),
      member("c"),
    ]);
    tx.groupMember.findMany.mockResolvedValue([member("c")]);

    await expect(leaveGroup("c", "g1")).rejects.toThrow(LastMemberError);

    expect(tx.groupMember.delete).not.toHaveBeenCalled();
    expect(tx.notification.createMany).not.toHaveBeenCalled();
  });
});

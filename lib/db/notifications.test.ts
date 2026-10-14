import { describe, expect, it, vi } from "vitest";

import {
  countUnreadNotifications,
  listNotifications,
  markNotificationRead,
  recordInAppNotification,
} from "./notifications";
import { NotificationKind } from "@/lib/generated/prisma/enums";

/**
 * No real database anywhere in this file — a hand-built fake with just the
 * methods this module calls, same convention as
 * `lib/db/notification-log.test.ts`. `__tests__/` is where the real
 * Postgres round trip (the foreign keys, the composite index) would be
 * checked, the same split every other `lib/db/*.ts` in this codebase uses.
 */

function fakeClient() {
  return {
    notification: {
      create: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    groupMember: { findMany: vi.fn() },
  };
}

describe("recordInAppNotification", () => {
  it("writes a row for a meeting-scoped kind", async () => {
    const client = fakeClient();

    await recordInAppNotification(
      {
        userId: "user-1",
        kind: NotificationKind.proposal_waiting,
        meetingId: "meeting-1",
      },
      client
    );

    expect(client.notification.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        kind: NotificationKind.proposal_waiting,
        meetingId: "meeting-1",
      },
    });
  });

  it("writes null meetingId for a user-scoped kind (calendar_reconnect)", async () => {
    const client = fakeClient();

    await recordInAppNotification(
      { userId: "user-1", kind: NotificationKind.calendar_reconnect },
      client
    );

    expect(client.notification.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        kind: NotificationKind.calendar_reconnect,
        meetingId: null,
      },
    });
  });

  it("writes what a group notice says, so it survives the group", async () => {
    const client = fakeClient();

    await recordInAppNotification(
      {
        userId: "user-1",
        kind: NotificationKind.group_inactive,
        groupId: "group-1",
        groupName: "השישיה",
        actorName: "דנה",
        meetingsCancelled: 2,
      },
      client
    );

    expect(client.notification.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        kind: NotificationKind.group_inactive,
        meetingId: null,
        groupId: "group-1",
        groupName: "השישיה",
        actorName: "דנה",
        meetingsCancelled: 2,
      },
    });
  });

  it("never throws — a logging failure must not take down the email it rides alongside", async () => {
    const client = fakeClient();
    client.notification.create.mockRejectedValueOnce(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      recordInAppNotification(
        { userId: "user-1", kind: NotificationKind.stuck, meetingId: "m1" },
        client
      )
    ).resolves.toBeUndefined();

    vi.restoreAllMocks();
  });
});

describe("countUnreadNotifications", () => {
  it("counts only this user's unread rows", async () => {
    const client = fakeClient();
    client.notification.count.mockResolvedValueOnce(3);

    const count = await countUnreadNotifications("user-1", client);

    expect(count).toBe(3);
    expect(client.notification.count).toHaveBeenCalledWith({
      where: { userId: "user-1", readAt: null },
    });
  });
});

describe("listNotifications", () => {
  it("maps rows to cards, newest first, isNew true only when readAt is null", async () => {
    const client = fakeClient();
    client.notification.findMany.mockResolvedValueOnce([
      {
        id: "n1",
        kind: NotificationKind.proposal_waiting,
        meetingId: "meeting-1",
        createdAt: new Date("2026-10-01T10:00:00.000Z"),
        readAt: null,
      },
      {
        id: "n2",
        kind: NotificationKind.meeting_confirmed,
        meetingId: "meeting-2",
        createdAt: new Date("2026-09-30T10:00:00.000Z"),
        readAt: new Date("2026-09-30T11:00:00.000Z"),
      },
    ]);

    const cards = await listNotifications("user-1", client);

    expect(client.notification.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    expect(cards).toEqual([
      {
        id: "n1",
        kind: NotificationKind.proposal_waiting,
        meetingId: "meeting-1",
        createdAt: "2026-10-01T10:00:00.000Z",
        isNew: true,
      },
      {
        id: "n2",
        kind: NotificationKind.meeting_confirmed,
        meetingId: "meeting-2",
        createdAt: "2026-09-30T10:00:00.000Z",
        isNew: false,
      },
    ]);
  });
});

describe("listNotifications, group notices (#250)", () => {
  const groupRow = (id: string, groupId: string) => ({
    id,
    kind: NotificationKind.member_left,
    meetingId: null,
    groupId,
    groupName: "השישיה",
    actorName: "דנה",
    meetingsCancelled: null,
    createdAt: new Date("2026-10-01T10:00:00.000Z"),
    readAt: null,
  });

  it("links a notice only to a group the person is still in", async () => {
    const client = fakeClient();
    client.notification.findMany.mockResolvedValueOnce([
      groupRow("n1", "group-here"),
      groupRow("n2", "group-gone"),
    ]);
    client.groupMember.findMany.mockResolvedValueOnce([
      { groupId: "group-here" },
    ]);

    const cards = await listNotifications("user-1", client);

    expect(client.groupMember.findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        groupId: { in: ["group-here", "group-gone"] },
      },
      select: { groupId: true },
    });
    expect(cards[0].group).toEqual({
      id: "group-here",
      name: "השישיה",
      actorName: "דנה",
      meetingsCancelled: null,
      linkable: true,
    });
    expect(cards[1].group?.linkable).toBe(false);
  });

  it("asks nothing about groups when no notice is about one", async () => {
    const client = fakeClient();
    client.notification.findMany.mockResolvedValueOnce([]);

    await listNotifications("user-1", client);

    expect(client.groupMember.findMany).not.toHaveBeenCalled();
  });
});

describe("markNotificationRead (#238)", () => {
  it("sets readAt on that one unread row of this user's, to the given time", async () => {
    const client = fakeClient();
    const now = new Date("2026-10-01T12:00:00.000Z");

    await markNotificationRead("user-1", "n1", now, client);

    expect(client.notification.updateMany).toHaveBeenCalledWith({
      where: { id: "n1", userId: "user-1", readAt: null },
      data: { readAt: now },
    });
  });
});

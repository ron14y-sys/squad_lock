import { describe, expect, it, vi } from "vitest";

import {
  countUnreadNotifications,
  listNotifications,
  markAllNotificationsRead,
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

describe("markAllNotificationsRead", () => {
  it("sets readAt on every unread row for this user, to the given time", async () => {
    const client = fakeClient();
    const now = new Date("2026-10-01T12:00:00.000Z");

    await markAllNotificationsRead("user-1", now, client);

    expect(client.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", readAt: null },
      data: { readAt: now },
    });
  });
});

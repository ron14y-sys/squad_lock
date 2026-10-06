import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isNotificationDue,
  MAX_NOTIFICATION_ATTEMPTS,
  NOTIFICATION_RETRY_COOLDOWN_MS,
  retryDueNotifications,
} from "./retry";
import {
  InvitationStatus,
  MeetingStatus,
  NotificationKind,
  NotificationStatus,
  ResponseStatus,
} from "@/lib/generated/prisma/enums";

/**
 * Same discipline as `lib/email/notify.test.ts`: no real database, no real
 * network. `fetch` is mocked the same way; the DB side is a hand-built fake
 * covering exactly the delegate methods `retry.ts` calls --
 * `notificationLog.findMany`/`updateMany`/`create`, `invitation.findUnique`,
 * `meeting.findUnique` and `response.findFirst` (the live-state re-check).
 *
 * The meeting fake defaults to `stuck`, so the default `failedRow` (a
 * `stuck` email) is still worth sending; tests about other states override.
 */

function fakeClient() {
  return {
    notificationLog: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    invitation: { findUnique: vi.fn() },
    meeting: {
      findUnique: vi.fn().mockResolvedValue({ status: MeetingStatus.stuck }),
    },
    response: { findFirst: vi.fn() },
  };
}

function fakeResponse(ok: boolean, body: unknown) {
  return {
    ok,
    status: ok ? 200 : 400,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

function failedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "log-1",
    kind: NotificationKind.stuck,
    recipientEmail: "dana@example.test",
    status: NotificationStatus.failed,
    retriedAt: null,
    attempt: 1,
    createdAt: new Date("2026-09-30T10:00:00Z"),
    meetingId: "meeting-1",
    invitationId: null,
    ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("RESEND_API_KEY", "test-key");
  vi.stubEnv("RESEND_FROM_ADDRESS", "SquadLock <noreply@squadlock.example>");
  vi.stubEnv("APP_BASE_URL", "https://squadlock.example");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("isNotificationDue", () => {
  const now = new Date("2026-09-30T10:10:00Z"); // 10 minutes after createdAt

  it("is due once the cooldown has passed on a failed, unclaimed row under the attempt cap", () => {
    expect(isNotificationDue(failedRow(), now)).toBe(true);
  });

  it("is not due before the cooldown has passed", () => {
    const recent = new Date("2026-09-30T10:01:00Z"); // 1 minute after createdAt
    expect(isNotificationDue(failedRow(), recent)).toBe(false);
  });

  it("is exactly due at the cooldown boundary", () => {
    const boundary = new Date(
      failedRow().createdAt.getTime() + NOTIFICATION_RETRY_COOLDOWN_MS
    );
    expect(isNotificationDue(failedRow(), boundary)).toBe(true);
  });

  it("is not due for a sent row", () => {
    expect(
      isNotificationDue(failedRow({ status: NotificationStatus.sent }), now)
    ).toBe(false);
  });

  it("is not due once already claimed by another poll", () => {
    expect(isNotificationDue(failedRow({ retriedAt: new Date() }), now)).toBe(
      false
    );
  });

  it("is not due at or past the attempt cap", () => {
    expect(
      isNotificationDue(failedRow({ attempt: MAX_NOTIFICATION_ATTEMPTS }), now)
    ).toBe(false);
  });
});

describe("retryDueNotifications", () => {
  it("skips a row that is not due yet, claims nothing and sends nothing", async () => {
    const client = fakeClient();
    client.notificationLog.findMany.mockResolvedValueOnce([
      failedRow({ createdAt: new Date() }), // just failed, inside the cooldown
    ]);

    await retryDueNotifications(
      "group-1",
      client,
      new Date("2026-09-30T10:00:01Z")
    );

    expect(client.notificationLog.updateMany).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("claims a due row, resends, and logs the retry one attempt higher", async () => {
    const client = fakeClient();
    const row = failedRow();
    client.notificationLog.findMany.mockResolvedValueOnce([row]);
    client.notificationLog.updateMany.mockResolvedValueOnce({ count: 1 });
    fetchMock.mockResolvedValueOnce(fakeResponse(true, { id: "email-retry" }));

    const now = new Date("2026-09-30T10:10:00Z");
    await retryDueNotifications("group-1", client, now);

    expect(client.notificationLog.updateMany).toHaveBeenCalledWith({
      where: { id: "log-1", retriedAt: null },
      data: { retriedAt: now },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.to).toBe("dana@example.test");

    expect(client.notificationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: NotificationKind.stuck,
          recipientEmail: "dana@example.test",
          status: NotificationStatus.sent,
          attempt: 2,
          meetingId: "meeting-1",
        }),
      })
    );
  });

  it("B10: sends nothing for a calendar_reconnect row -- the query itself never returns one, this is just the exhaustive switch's own branch", async () => {
    const client = fakeClient();
    client.notificationLog.findMany.mockResolvedValueOnce([
      failedRow({
        kind: NotificationKind.calendar_reconnect,
        meetingId: null,
        invitationId: null,
      }),
    ]);
    client.notificationLog.updateMany.mockResolvedValueOnce({ count: 1 });

    await retryDueNotifications(
      "group-1",
      client,
      new Date("2026-09-30T10:10:00Z")
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(client.notificationLog.create).not.toHaveBeenCalled();
  });

  it("does not retry a row another poll already claimed (lost the race)", async () => {
    const client = fakeClient();
    client.notificationLog.findMany.mockResolvedValueOnce([failedRow()]);
    client.notificationLog.updateMany.mockResolvedValueOnce({ count: 0 });

    await retryDueNotifications(
      "group-1",
      client,
      new Date("2026-09-30T10:10:00Z")
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(client.notificationLog.create).not.toHaveBeenCalled();
  });

  it("scopes the query to this group's own meetings and invitations, and to due failures", async () => {
    const client = fakeClient();
    client.notificationLog.findMany.mockResolvedValueOnce([]);

    await retryDueNotifications(
      "group-42",
      client,
      new Date("2026-09-30T10:10:00Z")
    );

    expect(client.notificationLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: NotificationStatus.failed,
          retriedAt: null,
          OR: [
            { meeting: { groupId: "group-42" } },
            { invitation: { groupId: "group-42" } },
          ],
        },
      })
    );
  });

  describe("invitation kind", () => {
    it("resends to the same address on a still-pending invitation", async () => {
      const client = fakeClient();
      client.notificationLog.findMany.mockResolvedValueOnce([
        failedRow({
          kind: NotificationKind.invitation,
          meetingId: null,
          invitationId: "invitation-1",
        }),
      ]);
      client.notificationLog.updateMany.mockResolvedValueOnce({ count: 1 });
      client.invitation.findUnique.mockResolvedValueOnce({
        id: "invitation-1",
        email: "new-member@example.test",
        token: "tok-abc",
        status: InvitationStatus.pending,
        group: { name: "Rothschild crew" },
        invitedBy: { name: "Dana" },
      });
      fetchMock.mockResolvedValueOnce(
        fakeResponse(true, { id: "email-retry" })
      );

      await retryDueNotifications(
        "group-1",
        client,
        new Date("2026-09-30T10:10:00Z")
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, init] = fetchMock.mock.calls[0];
      const body = JSON.parse(init.body as string);
      // The retry goes to the row's own recipientEmail, not the
      // invitation's current `.email` -- see this file's header comment.
      expect(body.to).toBe("dana@example.test");
      expect(body.html).toContain(
        "https://squadlock.example/invitations/tok-abc"
      );
      expect(client.notificationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            invitationId: "invitation-1",
            attempt: 2,
          }),
        })
      );
    });

    it("skips silently when the invitation was already accepted by the time this runs", async () => {
      const client = fakeClient();
      client.notificationLog.findMany.mockResolvedValueOnce([
        failedRow({
          kind: NotificationKind.invitation,
          meetingId: null,
          invitationId: "invitation-1",
        }),
      ]);
      client.notificationLog.updateMany.mockResolvedValueOnce({ count: 1 });
      client.invitation.findUnique.mockResolvedValueOnce({
        id: "invitation-1",
        email: "new-member@example.test",
        token: "tok-abc",
        status: InvitationStatus.accepted,
        group: { name: "Rothschild crew" },
        invitedBy: { name: "Dana" },
      });

      await retryDueNotifications(
        "group-1",
        client,
        new Date("2026-09-30T10:10:00Z")
      );

      expect(fetchMock).not.toHaveBeenCalled();
      expect(client.notificationLog.create).not.toHaveBeenCalled();
    });

    it("skips silently when the invitation row is gone", async () => {
      const client = fakeClient();
      client.notificationLog.findMany.mockResolvedValueOnce([
        failedRow({
          kind: NotificationKind.invitation,
          meetingId: null,
          invitationId: "invitation-1",
        }),
      ]);
      client.notificationLog.updateMany.mockResolvedValueOnce({ count: 1 });
      client.invitation.findUnique.mockResolvedValueOnce(null);

      await retryDueNotifications(
        "group-1",
        client,
        new Date("2026-09-30T10:10:00Z")
      );

      expect(fetchMock).not.toHaveBeenCalled();
      expect(client.notificationLog.create).not.toHaveBeenCalled();
    });
  });

  describe("live-state re-check (B9)", () => {
    const now = new Date("2026-09-30T10:10:00Z");

    async function retry(
      client: ReturnType<typeof fakeClient>,
      row: Record<string, unknown>
    ) {
      client.notificationLog.findMany.mockResolvedValueOnce([failedRow(row)]);
      client.notificationLog.updateMany.mockResolvedValueOnce({ count: 1 });
      fetchMock.mockResolvedValue(fakeResponse(true, { id: "email-retry" }));
      await retryDueNotifications("group-1", client, now);
    }

    it("resends proposal_waiting while the meeting is awaiting and the recipient is still pending", async () => {
      const client = fakeClient();
      client.meeting.findUnique.mockResolvedValue({
        status: MeetingStatus.awaiting,
      });
      client.response.findFirst.mockResolvedValue({
        status: ResponseStatus.pending,
      });

      await retry(client, { kind: NotificationKind.proposal_waiting });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      // Matched by the row's own address, scoped to the meeting.
      expect(client.response.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            meetingId: "meeting-1",
            user: { email: "dana@example.test" },
          },
        })
      );
    });

    it("skips proposal_waiting once the recipient has already answered", async () => {
      const client = fakeClient();
      client.meeting.findUnique.mockResolvedValue({
        status: MeetingStatus.awaiting,
      });
      client.response.findFirst.mockResolvedValue({
        status: ResponseStatus.approved,
      });

      await retry(client, { kind: NotificationKind.proposal_waiting });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(client.notificationLog.create).not.toHaveBeenCalled();
    });

    it("skips proposal_waiting once the meeting has gone back to weighing", async () => {
      const client = fakeClient();
      client.meeting.findUnique.mockResolvedValue({
        status: MeetingStatus.weighing,
      });
      client.response.findFirst.mockResolvedValue({
        status: ResponseStatus.pending,
      });

      await retry(client, { kind: NotificationKind.proposal_waiting });

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("skips proposal_waiting when the recipient has no response row any more", async () => {
      const client = fakeClient();
      client.meeting.findUnique.mockResolvedValue({
        status: MeetingStatus.awaiting,
      });
      client.response.findFirst.mockResolvedValue(null);

      await retry(client, { kind: NotificationKind.proposal_waiting });

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("skips stuck once the meeting is no longer stuck", async () => {
      const client = fakeClient();
      client.meeting.findUnique.mockResolvedValue({
        status: MeetingStatus.weighing,
      });

      await retry(client, { kind: NotificationKind.stuck });

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
      NotificationKind.meeting_confirmed,
      NotificationKind.conflict_reweigh,
    ])("still resends %s after the meeting has moved on", async (kind) => {
      const client = fakeClient();
      client.meeting.findUnique.mockResolvedValue({
        status: MeetingStatus.closed,
      });

      await retry(client, { kind });

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each([
      NotificationKind.meeting_confirmed,
      NotificationKind.conflict_reweigh,
    ])("skips %s once the meeting was cancelled", async (kind) => {
      const client = fakeClient();
      client.meeting.findUnique.mockResolvedValue({
        status: MeetingStatus.cancelled,
      });

      await retry(client, { kind });

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("skips silently when the meeting row is gone", async () => {
      const client = fakeClient();
      client.meeting.findUnique.mockResolvedValue(null);

      await retry(client, { kind: NotificationKind.stuck });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(client.notificationLog.create).not.toHaveBeenCalled();
    });

    it("does not throw when the live-state lookup itself fails", async () => {
      const client = fakeClient();
      client.meeting.findUnique.mockRejectedValue(new Error("db down"));

      await expect(
        retry(client, { kind: NotificationKind.stuck })
      ).resolves.toBeUndefined();

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("does not throw when the retried send fails again -- logs it at the higher attempt", async () => {
    const client = fakeClient();
    client.notificationLog.findMany.mockResolvedValueOnce([failedRow()]);
    client.notificationLog.updateMany.mockResolvedValueOnce({ count: 1 });
    fetchMock.mockResolvedValueOnce(fakeResponse(false, "still down"));

    await expect(
      retryDueNotifications("group-1", client, new Date("2026-09-30T10:10:00Z"))
    ).resolves.toBeUndefined();

    expect(client.notificationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: NotificationStatus.failed,
          attempt: 2,
          errorMessage: expect.stringContaining("still down"),
        }),
      })
    );
  });

  it("does not throw when the invitation lookup itself fails", async () => {
    const client = fakeClient();
    client.notificationLog.findMany.mockResolvedValueOnce([
      failedRow({
        kind: NotificationKind.invitation,
        meetingId: null,
        invitationId: "invitation-1",
      }),
    ]);
    client.notificationLog.updateMany.mockResolvedValueOnce({ count: 1 });
    client.invitation.findUnique.mockRejectedValueOnce(new Error("db down"));

    await expect(
      retryDueNotifications("group-1", client, new Date("2026-09-30T10:10:00Z"))
    ).resolves.toBeUndefined();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

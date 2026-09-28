import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  notifyConflictReweigh,
  notifyInvitation,
  notifyMeetingConfirmed,
  notifyProposalWaiting,
  notifyStuck,
} from "./notify";
import {
  NotificationKind,
  NotificationStatus,
} from "@/lib/generated/prisma/enums";

/**
 * No real database and no real network anywhere in this file -- same
 * discipline as `lib/db/places-cache.test.ts`. The DB side is a hand-built
 * fake (`response.findMany`, `invitation.findUnique`,
 * `notificationLog.create`); `fetch` is mocked the same way
 * `lib/email/client.test.ts` mocks it.
 */

function fakeClient() {
  return {
    response: { findMany: vi.fn() },
    invitation: { findUnique: vi.fn() },
    notificationLog: { create: vi.fn() },
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

describe("notifyProposalWaiting", () => {
  it("emails only the pending responses, and logs each as sent", async () => {
    const client = fakeClient();
    client.response.findMany.mockResolvedValueOnce([
      { user: { email: "dana@example.test" } },
      { user: { email: "yoav@example.test" } },
    ]);
    fetchMock.mockResolvedValue(fakeResponse(true, { id: "email-x" }));

    await notifyProposalWaiting("meeting-1", client);

    expect(client.response.findMany).toHaveBeenCalledWith({
      where: { meetingId: "meeting-1", status: "pending" },
      include: { user: { select: { email: true } } },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(client.notificationLog.create).toHaveBeenCalledTimes(2);
    expect(client.notificationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: NotificationKind.proposal_waiting,
          recipientEmail: "dana@example.test",
          status: NotificationStatus.sent,
          providerMessageId: "email-x",
          meetingId: "meeting-1",
        }),
      })
    );
  });

  it("sends nobody, and logs nothing, when nobody is pending", async () => {
    const client = fakeClient();
    client.response.findMany.mockResolvedValueOnce([]);

    await notifyProposalWaiting("meeting-1", client);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(client.notificationLog.create).not.toHaveBeenCalled();
  });

  it("logs a failure and does not throw when the send itself fails", async () => {
    const client = fakeClient();
    client.response.findMany.mockResolvedValueOnce([
      { user: { email: "dana@example.test" } },
    ]);
    fetchMock.mockResolvedValueOnce(fakeResponse(false, "quota exceeded"));

    await expect(
      notifyProposalWaiting("meeting-1", client)
    ).resolves.toBeUndefined();

    expect(client.notificationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: NotificationStatus.failed,
          errorMessage: expect.stringContaining("quota exceeded"),
        }),
      })
    );
  });

  it("does not throw even when recordNotification itself fails on both the success and the failure path", async () => {
    const client = fakeClient();
    client.response.findMany.mockResolvedValueOnce([
      { user: { email: "dana@example.test" } },
    ]);
    client.notificationLog.create.mockRejectedValue(new Error("db down"));
    fetchMock.mockResolvedValueOnce(fakeResponse(true, { id: "email-x" }));

    await expect(
      notifyProposalWaiting("meeting-1", client)
    ).resolves.toBeUndefined();
  });
});

describe("notifyInvitation", () => {
  it("emails the invited address, not a User, and logs it against the invitation", async () => {
    const client = fakeClient();
    client.invitation.findUnique.mockResolvedValueOnce({
      id: "invitation-1",
      email: "new-member@example.test",
      token: "tok-abc",
      group: { name: "Rothschild crew" },
      invitedBy: { name: "Dana" },
    });
    fetchMock.mockResolvedValueOnce(fakeResponse(true, { id: "email-x" }));

    await notifyInvitation("invitation-1", client);

    expect(client.invitation.findUnique).toHaveBeenCalledWith({
      where: { id: "invitation-1" },
      include: {
        group: { select: { name: true } },
        invitedBy: { select: { name: true } },
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.to).toBe("new-member@example.test");
    expect(body.html).toContain(
      "https://squadlock.example/invitations/tok-abc"
    );

    expect(client.notificationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: NotificationKind.invitation,
          recipientEmail: "new-member@example.test",
          status: NotificationStatus.sent,
          invitationId: "invitation-1",
        }),
      })
    );
  });

  it("sends nothing when the invitation row is gone by the time this runs", async () => {
    const client = fakeClient();
    client.invitation.findUnique.mockResolvedValueOnce(null);

    await expect(
      notifyInvitation("invitation-1", client)
    ).resolves.toBeUndefined();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(client.notificationLog.create).not.toHaveBeenCalled();
  });
});

describe("notifyMeetingConfirmed", () => {
  it("emails everyone still in, not someone who dropped out", async () => {
    const client = fakeClient();
    client.response.findMany.mockResolvedValueOnce([
      { user: { email: "dana@example.test" } },
      { user: { email: "yoav@example.test" } },
    ]);
    fetchMock.mockResolvedValue(fakeResponse(true, { id: "email-x" }));

    await notifyMeetingConfirmed("meeting-1", client);

    expect(client.response.findMany).toHaveBeenCalledWith({
      where: { meetingId: "meeting-1", status: { not: "cant_make_it" } },
      include: { user: { select: { email: true } } },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(client.notificationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: NotificationKind.meeting_confirmed,
          meetingId: "meeting-1",
        }),
      })
    );
  });
});

describe("notifyConflictReweigh", () => {
  it("emails still-in participants of the cancelled meeting", async () => {
    const client = fakeClient();
    client.response.findMany.mockResolvedValueOnce([
      { user: { email: "yoav@example.test" } },
    ]);
    fetchMock.mockResolvedValueOnce(fakeResponse(true, { id: "email-x" }));

    await notifyConflictReweigh("meeting-2", client);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(client.notificationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: NotificationKind.conflict_reweigh,
          recipientEmail: "yoav@example.test",
          meetingId: "meeting-2",
        }),
      })
    );
  });
});

describe("notifyStuck", () => {
  it("emails everyone still in the stuck meeting", async () => {
    const client = fakeClient();
    client.response.findMany.mockResolvedValueOnce([
      { user: { email: "dana@example.test" } },
    ]);
    fetchMock.mockResolvedValueOnce(fakeResponse(true, { id: "email-x" }));

    await notifyStuck("meeting-3", client);

    expect(client.notificationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: NotificationKind.stuck,
          meetingId: "meeting-3",
        }),
      })
    );
  });
});

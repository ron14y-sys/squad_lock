import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { notifyProposalWaiting } from "./notify";
import {
  NotificationKind,
  NotificationStatus,
} from "@/lib/generated/prisma/enums";

/**
 * No real database and no real network anywhere in this file -- same
 * discipline as `lib/db/places-cache.test.ts`. The DB side is a hand-built
 * fake (`response.findMany`, `notificationLog.create`); `fetch` is mocked
 * the same way `lib/email/client.test.ts` mocks it.
 */

function fakeClient() {
  return {
    response: { findMany: vi.fn() },
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

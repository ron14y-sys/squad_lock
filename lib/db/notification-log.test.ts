import { describe, expect, it, vi } from "vitest";

import { recordNotification } from "./notification-log";
import {
  NotificationKind,
  NotificationStatus,
} from "@/lib/generated/prisma/enums";

/**
 * No real database anywhere in this file -- a hand-built fake with just the
 * one method (`create`) this module calls, same convention as
 * `lib/db/places-cache.test.ts`.
 */

function fakeClient() {
  return { notificationLog: { create: vi.fn() } };
}

describe("recordNotification", () => {
  it("writes a sent row with the provider message id, meetingId set, invitationId left null", async () => {
    const client = fakeClient();

    await recordNotification(
      {
        kind: NotificationKind.proposal_waiting,
        recipientEmail: "dana@example.test",
        status: NotificationStatus.sent,
        providerMessageId: "email-1",
        meetingId: "meeting-1",
      },
      client
    );

    expect(client.notificationLog.create).toHaveBeenCalledWith({
      data: {
        kind: NotificationKind.proposal_waiting,
        recipientEmail: "dana@example.test",
        status: NotificationStatus.sent,
        providerMessageId: "email-1",
        errorMessage: null,
        meetingId: "meeting-1",
        invitationId: null,
      },
    });
  });

  it("writes a failed row with the error message, no providerMessageId", async () => {
    const client = fakeClient();

    await recordNotification(
      {
        kind: NotificationKind.proposal_waiting,
        recipientEmail: "dana@example.test",
        status: NotificationStatus.failed,
        errorMessage: "email: send failed (401): invalid api key",
        meetingId: "meeting-1",
      },
      client
    );

    expect(client.notificationLog.create).toHaveBeenCalledWith({
      data: {
        kind: NotificationKind.proposal_waiting,
        recipientEmail: "dana@example.test",
        status: NotificationStatus.failed,
        providerMessageId: null,
        errorMessage: "email: send failed (401): invalid api key",
        meetingId: "meeting-1",
        invitationId: null,
      },
    });
  });

  it("leaves meetingId null and sets invitationId, for an invitation email", async () => {
    const client = fakeClient();

    await recordNotification(
      {
        kind: NotificationKind.invitation,
        recipientEmail: "new-member@example.test",
        status: NotificationStatus.sent,
        providerMessageId: "email-2",
        invitationId: "invitation-1",
      },
      client
    );

    expect(client.notificationLog.create).toHaveBeenCalledWith({
      data: {
        kind: NotificationKind.invitation,
        recipientEmail: "new-member@example.test",
        status: NotificationStatus.sent,
        providerMessageId: "email-2",
        errorMessage: null,
        meetingId: null,
        invitationId: "invitation-1",
      },
    });
  });
});

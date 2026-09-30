/**
 * B8 -- persistence for `NotificationLog` (spec §5.5, §6.3 #4).
 *
 * Same DI convention as `lib/db/places-cache.ts`: a `client` parameter
 * defaulting to `getPrisma()`, narrowed to the one delegate method this
 * file actually calls -- `create`, nothing else -- so `lib/email/notify.ts`
 * can be unit-tested against a hand-built fake client, no `DATABASE_URL`.
 *
 * This is deliberately the only thing this file does. It does not decide
 * *when* to log, or what to do about a failure -- that is
 * `lib/email/notify.ts`'s never-throw orchestration layer. This file just
 * writes the row.
 *
 * B9 part one added `attempt`: still just a field this file passes through
 * on `create`, same as every other column -- the retry decision itself
 * lives in `lib/email/retry.ts`, not here.
 */

import { getPrisma } from "./client";
import type { PrismaClient } from "@/lib/generated/prisma/client";
import type {
  NotificationKind,
  NotificationStatus,
} from "@/lib/generated/prisma/enums";

type NotificationLogClient = {
  notificationLog: Pick<PrismaClient["notificationLog"], "create">;
};

export type RecordNotificationInput = {
  kind: NotificationKind;
  recipientEmail: string;
  status: NotificationStatus;
  providerMessageId?: string;
  errorMessage?: string;
  meetingId?: string;
  invitationId?: string;
  /** Defaults to 1 -- the first send. A retry passes its own higher count. */
  attempt?: number;
};

/**
 * Appends one row -- never updates or reads one back. `meetingId` and
 * `invitationId` are both left `undefined` unless the caller sets one;
 * `lib/email/notify.ts`'s own callers are what decide which (if either)
 * applies, matching the schema's "at most one of them" comment.
 */
export async function recordNotification(
  input: RecordNotificationInput,
  client: NotificationLogClient = getPrisma()
): Promise<void> {
  await client.notificationLog.create({
    data: {
      kind: input.kind,
      recipientEmail: input.recipientEmail,
      status: input.status,
      providerMessageId: input.providerMessageId ?? null,
      errorMessage: input.errorMessage ?? null,
      meetingId: input.meetingId ?? null,
      invitationId: input.invitationId ?? null,
      attempt: input.attempt ?? 1,
    },
  });
}

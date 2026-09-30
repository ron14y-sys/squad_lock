/**
 * B9 part one -- retrying a failed email send (spec's open question #10,
 * issue #33). `lib/email/notify.ts`'s binding rule already covers *this*
 * file's other half: a failed send never blocks whatever triggered it. What
 * was still missing is the other direction -- nothing ever looked at a
 * `NotificationStatus.failed` row again.
 *
 * ## Why a new row, not an update
 *
 * `NotificationLog` is append-only, same as `MatchRun`: every send, retried
 * or not, is its own row. A retry does not rewrite the row it retries --
 * it calls `sendAndLog` again, which writes a fresh one with `attempt` one
 * higher. `attempt`/`retriedAt` on the *original* row only ever move the
 * claim forward; the history underneath stays intact.
 *
 * ## Claiming -- `runDueMeetings`'s trick, aimed at a different column
 *
 * Two polls racing for the same failed row must not both resend it.
 * `runDueMeetings` solves the equivalent problem with a conditional
 * `updateMany` against `Meeting.updatedAt`; this does the same against
 * `NotificationLog.retriedAt`, which starts `null` and is claimed exactly
 * once. The row that claim lands on is never retried again, whatever
 * happens next -- the *new* row `sendAndLog` writes is what becomes
 * eligible for the next attempt, if there is one.
 *
 * ## Content is rebuilt, not replayed
 *
 * `NotificationLog` never stored `subject`/`html`, so a retry regenerates
 * the same content a fresh send would, from `kind` and the row's own refs
 * (`meetingId`/`invitationId`) -- never the recipient set a `notify*`
 * function would recompute, which could have changed. The one recipient
 * this row already names is who was owed *this* email, so that is exactly
 * who gets the retry, nobody wider and nobody narrower.
 *
 * Known gap, same shape as `notifyProposalWaiting`'s own documented one:
 * content is not re-checked against the meeting's *current* state, so a
 * `proposal_waiting` retry can land after the recipient already answered.
 * Not fixed here -- flagged in `tasks/todo.md`.
 *
 * ## The trigger -- the same poll, no new surface
 *
 * Called from the group feed's own `after()`, right beside
 * `runDueMeetings(groupId)` -- "no cron and no background job" (spec
 * §3.2) applies here exactly as it does there. Scoped to one group's own
 * meetings and invitations, same as `runDueMeetings`.
 */

import { getPrisma } from "@/lib/db/client";
import { neverThrow, sendAndLog } from "./notify";
import {
  conflictReweighEmail,
  invitationEmail,
  meetingConfirmedEmail,
  proposalWaitingEmail,
  stuckEmail,
  type EmailContent,
} from "./templates";
import {
  InvitationStatus,
  NotificationKind,
  NotificationStatus,
} from "@/lib/generated/prisma/enums";
import type { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * How long a failed send sits before the next retry. Flat, not exponential
 * -- matches `run-cycle.ts`'s own constants (`RUN_ATTEMPT_COOLDOWN_MS` and
 * neighbours). There is no quota to protect here the way there is with
 * Gemini/Places; a Resend hiccup or a network blip is usually over well
 * inside this window, and a flat number is one less thing to explain.
 */
export const NOTIFICATION_RETRY_COOLDOWN_MS = 5 * 60_000;

/**
 * After this many attempts (the first send counts as one), a failure is
 * left alone. There is no user-facing "this never arrived" surface yet, so
 * past this point the row is just history -- see `NotificationLog` itself,
 * or the provider's own dashboard via `providerMessageId`.
 */
export const MAX_NOTIFICATION_ATTEMPTS = 5;

export type DueNotificationInput = {
  status: NotificationStatus;
  retriedAt: Date | null;
  attempt: number;
  createdAt: Date;
};

/**
 * Pure -- same split as `run-cycle.ts`'s `isDue`/`runDueMeetings`: the
 * timing decision is tested without a database or a clock.
 */
export function isNotificationDue(
  row: DueNotificationInput,
  now: Date
): boolean {
  if (row.status !== NotificationStatus.failed) return false;
  if (row.retriedAt !== null) return false;
  if (row.attempt >= MAX_NOTIFICATION_ATTEMPTS) return false;
  return (
    now.getTime() - row.createdAt.getTime() >= NOTIFICATION_RETRY_COOLDOWN_MS
  );
}

export type RetryClient = {
  notificationLog: Pick<
    PrismaClient["notificationLog"],
    "findMany" | "updateMany" | "create"
  >;
  invitation: Pick<PrismaClient["invitation"], "findUnique">;
};

/**
 * Rebuilds the content function `sendAndLog` needs, keyed only by `kind`
 * and this row's own refs -- see this file's header comment on why it is
 * never the recipient-computing `notify*` wrappers. `null` means there is
 * nothing left worth retrying: an invitation already accepted, or a row
 * whose invitation is gone.
 *
 * Returns a thunk, not a resolved `EmailContent`, for the same reason
 * `notifyInvitation` does -- `invitationEmail` itself can throw (a missing
 * `APP_BASE_URL`), and that has to land inside `sendAndLog`'s own try, not
 * out here. The async lookup this function does for the `invitation` kind
 * is the part that happens first and separately.
 */
async function regenerateContent(
  kind: NotificationKind,
  meetingId: string | null,
  invitationId: string | null,
  client: Pick<RetryClient, "invitation">
): Promise<(() => EmailContent) | null> {
  switch (kind) {
    case NotificationKind.invitation: {
      if (!invitationId) return null;
      const invitation = await client.invitation.findUnique({
        where: { id: invitationId },
        include: {
          group: { select: { name: true } },
          invitedBy: { select: { name: true } },
        },
      });
      if (!invitation || invitation.status !== InvitationStatus.pending) {
        // Gone, or already accepted -- nothing left to tell anyone.
        return null;
      }
      return () =>
        invitationEmail(
          invitation.group.name,
          invitation.invitedBy.name,
          invitation.token
        );
    }
    case NotificationKind.proposal_waiting:
      return meetingId ? () => proposalWaitingEmail(meetingId) : null;
    case NotificationKind.meeting_confirmed:
      return meetingId ? () => meetingConfirmedEmail(meetingId) : null;
    case NotificationKind.conflict_reweigh:
      return meetingId ? () => conflictReweighEmail(meetingId) : null;
    case NotificationKind.stuck:
      return meetingId ? () => stuckEmail(meetingId) : null;
  }
}

/**
 * Retries every failed send this group's own meetings and invitations owe,
 * and `isNotificationDue` says is ready. See this file's header comment for
 * the claim/content mechanics; this is just the loop over candidates,
 * same shape as `runDueMeetings`.
 */
export async function retryDueNotifications(
  groupId: string,
  client: RetryClient = getPrisma(),
  now: Date = new Date()
): Promise<void> {
  const candidates = await client.notificationLog.findMany({
    where: {
      status: NotificationStatus.failed,
      retriedAt: null,
      OR: [{ meeting: { groupId } }, { invitation: { groupId } }],
    },
    select: {
      id: true,
      kind: true,
      recipientEmail: true,
      status: true,
      retriedAt: true,
      attempt: true,
      createdAt: true,
      meetingId: true,
      invitationId: true,
    },
  });

  for (const row of candidates) {
    if (!isNotificationDue(row, now)) continue;

    const claimed = await client.notificationLog.updateMany({
      where: { id: row.id, retriedAt: null },
      data: { retriedAt: now },
    });
    if (claimed.count === 0) continue; // another poll already claimed it

    await neverThrow(row.kind, async () => {
      const content = await regenerateContent(
        row.kind,
        row.meetingId,
        row.invitationId,
        client
      );
      if (!content) return;

      await sendAndLog(
        row.kind,
        row.recipientEmail,
        content,
        {
          meetingId: row.meetingId ?? undefined,
          invitationId: row.invitationId ?? undefined,
        },
        client,
        row.attempt + 1
      );
    });
  }
}

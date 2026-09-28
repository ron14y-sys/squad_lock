/**
 * B8 -- the never-throw email orchestration layer (spec §5.5, §6.3 #4).
 *
 * Binding rule this file exists to enforce: **notification is not part of
 * meeting state.** A failed send never invalidates, reopens or blocks
 * whatever triggered it -- it is recorded and swallowed, here, in one
 * place, so every call site (a route's `after()`, or already-background
 * code like `run-cycle.ts`'s `weigh()`) can fire a `notify*` function
 * without a try/catch of its own.
 *
 * `sendAndLog` is the one place that touches both `lib/email/client.ts`
 * and `lib/db/notification-log.ts` -- every public `notify*` function
 * below is just "who, which template" and calls through it. The nested
 * catch around `recordNotification` itself is deliberate: a Postgres
 * hiccup while logging a *send* failure must not become an unhandled
 * rejection either.
 *
 * **`client` is injectable, same convention as `lib/db/places-cache.ts`**
 * -- narrowed to the two delegate methods this file actually calls
 * (`response.findMany`, `notificationLog.create`), defaulting to
 * `getPrisma()`. This is what makes `notifyProposalWaiting` unit-testable
 * against a hand-built fake, no `DATABASE_URL` and no module mocking (this
 * codebase never uses `vi.mock` -- see any other `lib/db/*.test.ts`). The
 * one real network edge, `sendEmail`, is still covered the same way
 * `lib/places/client.test.ts` covers Places: a mocked global `fetch`.
 *
 * Only `notifyProposalWaiting` exists yet -- B8 part one. The other four
 * triggers (invitation, meeting confirmed, conflict re-weigh, stuck) are
 * B8 part two, each getting its own `notify*` function here, wired into
 * the hook points `tasks/todo.md`'s B8 entry already names.
 */

import { getPrisma } from "@/lib/db/client";
import { recordNotification } from "@/lib/db/notification-log";
import { sendEmail } from "./client";
import { proposalWaitingEmail } from "./templates";
import {
  NotificationKind,
  NotificationStatus,
  ResponseStatus,
} from "@/lib/generated/prisma/enums";
import type { PrismaClient } from "@/lib/generated/prisma/client";

type NotifyClient = {
  response: Pick<PrismaClient["response"], "findMany">;
  notificationLog: Pick<PrismaClient["notificationLog"], "create">;
};

type NotificationRefs = {
  meetingId?: string;
  invitationId?: string;
};

/**
 * Sends one email and logs the outcome either way. Never throws -- a
 * failure is a `NotificationStatus.failed` row, not an exception, which is
 * what makes it safe to call from a route's `after()` (an unhandled
 * rejection there is somebody else's request falling over -- same reasoning
 * as `run-cycle.ts`'s own header comment on why *it* never throws).
 */
async function sendAndLog(
  kind: NotificationKind,
  recipientEmail: string,
  subject: string,
  html: string,
  refs: NotificationRefs,
  client: Pick<NotifyClient, "notificationLog">
): Promise<void> {
  try {
    const sent = await sendEmail({ to: recipientEmail, subject, html });
    await recordNotification(
      {
        kind,
        recipientEmail,
        status: NotificationStatus.sent,
        providerMessageId: sent.id,
        ...refs,
      },
      client
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      `[email] send failed kind=${kind} to=${recipientEmail}`,
      error
    );
    try {
      await recordNotification(
        {
          kind,
          recipientEmail,
          status: NotificationStatus.failed,
          errorMessage,
          ...refs,
        },
        client
      );
    } catch (logError) {
      // The send already failed; a failure to log that is not something a
      // caller can act on either. One more console line is the whole
      // fallback -- see the header comment.
      console.error(
        `[email] also failed to record the failure kind=${kind} to=${recipientEmail}`,
        logError
      );
    }
  }
}

/**
 * Spec §5.5 trigger #2 -- "a proposal is waiting on you." Recipients are
 * exactly who the feed itself would call `waiting_on_you`
 * (`lib/db/meeting-cards.ts`'s `deriveMeetingCardStatus`): a still-open
 * proposal, one Response row per recipient, status `pending`.
 *
 * Deliberately not "everyone still attending" -- someone who has already
 * approved or dropped out has nothing waiting on them for *this* proposal.
 *
 * ⚠️ Known gap, not fixed here: if a later re-weighing reuses this same
 * meeting without resetting an already-`approved` Response back to
 * `pending`, that participant is never re-notified about the replacement
 * proposal. Nothing in the codebase resets Response rows across cycles
 * today (grepped), so this is a pre-existing question about
 * `respondToMeeting`'s `doesnt_suit` branch, not something B8 introduces
 * or is scoped to fix -- flagged in `tasks/todo.md` for whoever picks it up.
 */
export async function notifyProposalWaiting(
  meetingId: string,
  client: NotifyClient = getPrisma()
): Promise<void> {
  const pendingResponses = await client.response.findMany({
    where: { meetingId, status: ResponseStatus.pending },
    include: { user: { select: { email: true } } },
  });

  const { subject, html } = proposalWaitingEmail(meetingId);

  await Promise.all(
    pendingResponses.map((response) =>
      sendAndLog(
        NotificationKind.proposal_waiting,
        response.user.email,
        subject,
        html,
        { meetingId },
        client
      )
    )
  );
}

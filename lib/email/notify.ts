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
 * -- narrowed to the delegate methods this file actually calls, defaulting
 * to `getPrisma()`. This is what makes every `notify*` function below
 * unit-testable against a hand-built fake, no `DATABASE_URL` and no module
 * mocking (this codebase never uses `vi.mock` -- see any other
 * `lib/db/*.test.ts`). The one real network edge, `sendEmail`, is still
 * covered the same way `lib/places/client.test.ts` covers Places: a
 * mocked global `fetch`.
 *
 * All five spec §5.5 triggers are wired now (B8 part two added the last
 * four): invitation, meeting confirmed, conflict re-weigh, stuck.
 * `stillInRecipients` is the query three of those four share -- everyone
 * on a meeting who has not dropped out, same definition as
 * `allStillInHaveApproved` and `assembleRun`'s `attending`.
 */

import { getPrisma } from "@/lib/db/client";
import { recordNotification } from "@/lib/db/notification-log";
import { sendEmail } from "./client";
import {
  calendarReconnectEmail,
  conflictReweighEmail,
  invitationEmail,
  meetingConfirmedEmail,
  proposalWaitingEmail,
  stuckEmail,
  type EmailContent,
} from "./templates";
import {
  NotificationKind,
  NotificationStatus,
  ResponseStatus,
} from "@/lib/generated/prisma/enums";
import type { PrismaClient } from "@/lib/generated/prisma/client";

type NotifyClient = {
  response: Pick<PrismaClient["response"], "findMany">;
  invitation: Pick<PrismaClient["invitation"], "findUnique">;
  user: Pick<PrismaClient["user"], "findUnique">;
  notificationLog: Pick<PrismaClient["notificationLog"], "create">;
};

export type NotificationRefs = {
  meetingId?: string;
  invitationId?: string;
};

/**
 * Sends one email and logs the outcome either way. Never throws -- a
 * failure is a `NotificationStatus.failed` row, not an exception, which is
 * what makes it safe to call from a route's `after()` (an unhandled
 * rejection there is somebody else's request falling over -- same reasoning
 * as `run-cycle.ts`'s own header comment on why *it* never throws).
 *
 * `content` is built in here, inside the catch, not by the caller: a
 * template throws on a missing `APP_BASE_URL`, and on 30.9 that escaped
 * `notifyProposalWaiting` and was logged as a failed matching run.
 *
 * `attempt` defaults to 1 (the first send) and is otherwise left to the
 * caller -- every `notify*` function below leaves it at the default.
 * `lib/email/retry.ts` (B9 part one) is the one caller that passes a higher
 * number, and exporting this is what lets it reuse the exact same send/log
 * path rather than duplicating it.
 */
export async function sendAndLog(
  kind: NotificationKind,
  recipientEmail: string,
  content: () => EmailContent,
  refs: NotificationRefs,
  client: Pick<NotifyClient, "notificationLog">,
  attempt: number = 1
): Promise<void> {
  try {
    const { subject, html } = content();
    const sent = await sendEmail({ to: recipientEmail, subject, html });
    await recordNotification(
      {
        kind,
        recipientEmail,
        status: NotificationStatus.sent,
        providerMessageId: sent.id,
        attempt,
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
          attempt,
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
 * The same contract for what happens before `sendAndLog`: finding the
 * recipients is a query, and a failed one is logged here rather than thrown
 * at whatever triggered the email.
 */
export async function neverThrow(
  kind: NotificationKind,
  work: () => Promise<void>
): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.error(`[email] notify failed before sending kind=${kind}`, error);
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
  await neverThrow(NotificationKind.proposal_waiting, async () => {
    const pendingResponses = await client.response.findMany({
      where: { meetingId, status: ResponseStatus.pending },
      include: { user: { select: { email: true } } },
    });

    await Promise.all(
      pendingResponses.map((response) =>
        sendAndLog(
          NotificationKind.proposal_waiting,
          response.user.email,
          () => proposalWaitingEmail(meetingId),
          { meetingId },
          client
        )
      )
    );
  });
}

/**
 * Everyone on a meeting who has not dropped out -- the same "still in"
 * definition `allStillInHaveApproved` and `assembleRun`'s `attending` both
 * use (not `cant_make_it`). Shared by three of the four triggers below;
 * `notifyProposalWaiting` above deliberately does not use this -- it wants
 * only `pending`, a narrower set (see its own header comment).
 */
async function stillInRecipients(
  meetingId: string,
  client: Pick<NotifyClient, "response">
): Promise<string[]> {
  const responses = await client.response.findMany({
    where: { meetingId, status: { not: ResponseStatus.cant_make_it } },
    include: { user: { select: { email: true } } },
  });
  return responses.map((response) => response.user.email);
}

/** `sendAndLog` to everyone `stillInRecipients` returns, in parallel. */
async function notifyStillIn(
  kind: NotificationKind,
  meetingId: string,
  content: () => EmailContent,
  client: NotifyClient
): Promise<void> {
  await neverThrow(kind, async () => {
    const recipients = await stillInRecipients(meetingId, client);

    await Promise.all(
      recipients.map((email) =>
        sendAndLog(kind, email, content, { meetingId }, client)
      )
    );
  });
}

/**
 * Spec §5.5 trigger #1 -- an invitation. Recipient is the invited address
 * itself, read straight off the `Invitation` row -- no `User` lookup,
 * because one may not exist yet (see `invitationEmail`'s own comment).
 *
 * A missing row (deleted, or an id that never existed) sends nothing
 * rather than throwing -- there is no invitation left to tell anyone
 * about, and this function's contract is "never throw" same as every
 * other `notify*` here.
 */
export async function notifyInvitation(
  invitationId: string,
  client: NotifyClient = getPrisma()
): Promise<void> {
  await neverThrow(NotificationKind.invitation, async () => {
    const invitation = await client.invitation.findUnique({
      where: { id: invitationId },
      include: {
        group: { select: { name: true } },
        invitedBy: { select: { name: true } },
      },
    });
    if (!invitation) return;

    await sendAndLog(
      NotificationKind.invitation,
      invitation.email,
      () =>
        invitationEmail(
          invitation.group.name,
          invitation.invitedBy.name,
          invitation.token
        ),
      { invitationId },
      client
    );
  });
}

/**
 * Spec §5.5 trigger #3 -- "meeting confirmed." Called only on the response
 * that actually flips a meeting to `closed` (`respondToMeeting`'s
 * `justClosed`) -- `closed` cannot be re-entered (`MeetingNotOpenError`),
 * so there is no double-fire case to guard against here the way
 * `notifyStuck` has to.
 */
export async function notifyMeetingConfirmed(
  meetingId: string,
  client: NotifyClient = getPrisma()
): Promise<void> {
  await notifyStillIn(
    NotificationKind.meeting_confirmed,
    meetingId,
    () => meetingConfirmedEmail(meetingId),
    client
  );
}

/**
 * Spec §5.5 trigger #4 -- a meeting bounced back to `weighing` by someone
 * else's approval elsewhere (spec §5.7). Called once per meeting in
 * `respondToMeeting`'s `cancelledConflicts`.
 */
export async function notifyConflictReweigh(
  meetingId: string,
  client: NotifyClient = getPrisma()
): Promise<void> {
  await notifyStillIn(
    NotificationKind.conflict_reweigh,
    meetingId,
    () => conflictReweighEmail(meetingId),
    client
  );
}

/**
 * Spec §5.5 trigger #5 -- `stuck`. Called from two independent places:
 * `respondToMeeting` reaching the cycle cap (guarded by its own
 * `justStuck`, since -- unlike `closed` -- a `stuck` meeting can still be
 * responded to again, and this must not re-fire on that), and `runCycle`
 * catching `NoSolutionError` (guarded there by the conditional update's own
 * row count, so a meeting someone else already moved off `weighing` is not
 * double-notified). One template, one function, because "why" the cap was
 * reached does not change what the email says.
 */
export async function notifyStuck(
  meetingId: string,
  client: NotifyClient = getPrisma()
): Promise<void> {
  await notifyStillIn(
    NotificationKind.stuck,
    meetingId,
    () => stuckEmail(meetingId),
    client
  );
}

/**
 * B10 -- a participant's Google refresh token was rejected
 * (`CalendarAuthError`). Called from `run-cycle.ts`'s fault branch, after
 * it has already cleared `User.googleRefreshToken` -- this function only
 * sends the email, same division as every other `notify*` here.
 *
 * Not `notifyStillIn` or any of the meeting-scoped helpers above: this is
 * one specific user, not a meeting's recipient list, and `refs` is `{}` --
 * see `calendarReconnectEmail`'s own header comment for why.
 */
export async function notifyCalendarReconnect(
  userId: string,
  client: NotifyClient = getPrisma()
): Promise<void> {
  await neverThrow(NotificationKind.calendar_reconnect, async () => {
    const user = await client.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user) return;

    await sendAndLog(
      NotificationKind.calendar_reconnect,
      user.email,
      () => calendarReconnectEmail(),
      {},
      client
    );
  });
}

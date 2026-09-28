/**
 * B8 -- email copy (spec §5.5). Hebrew, matching the rest of the app's
 * content (`lang="he" dir="rtl"`, see `app/layout.tsx`) -- "SquadLock"
 * itself stays Latin, the same choice the app's own title makes.
 *
 * One function per trigger, each returning `{subject, html}` rather than
 * writing anything -- `lib/email/notify.ts` is the only thing that calls
 * `sendEmail`, so a template can be unit-tested as plain string output,
 * no mocked `fetch`.
 *
 * All five spec §5.5 triggers are here now (B8 part two added the last
 * four): invitation, meeting confirmed, conflict re-weigh, stuck.
 */

/** Throws loudly rather than building a link with no host. */
function appBaseUrl(): string {
  const base = process.env.APP_BASE_URL;
  if (!base) {
    throw new Error("APP_BASE_URL is not set -- see .env.example.");
  }
  return base;
}

export type EmailContent = {
  subject: string;
  html: string;
};

/**
 * Spec §5.5 trigger #2 -- "a proposal is waiting on you." Sent to every
 * still-attending participant who has not yet approved, rejected or
 * dropped out of the meeting's current proposal.
 */
export function proposalWaitingEmail(meetingId: string): EmailContent {
  const link = `${appBaseUrl()}/meetings/${meetingId}`;

  return {
    subject: "יש הצעה חדשה שמחכה לך",
    html: `
      <p>שלום,</p>
      <p>קבוצה שלך ב-SquadLock קיבלה הצעה חדשה למפגש, והיא מחכה לתשובה שלך.</p>
      <p><a href="${link}">לחצו כאן לצפייה בהצעה</a></p>
    `.trim(),
  };
}

/**
 * Spec §5.5 trigger #1 -- an invitation. Sent to the invited address
 * itself, not a User -- the whole point of an invitation is that one may
 * not exist yet (see `app/api/groups/[id]/invitations/route.ts`'s own
 * header comment). Never resent on a re-invite of an address that already
 * has a pending invitation -- that path returns the existing row rather
 * than creating a new one, and only the create path calls this.
 */
export function invitationEmail(
  groupName: string,
  inviterName: string,
  token: string
): EmailContent {
  const link = `${appBaseUrl()}/invitations/${token}`;

  return {
    subject: `${inviterName} הזמינ/ה אותך להצטרף לקבוצה "${groupName}"`,
    html: `
      <p>שלום,</p>
      <p>${inviterName} הזמינ/ה אותך להצטרף לקבוצה "${groupName}" ב-SquadLock.</p>
      <p><a href="${link}">לחצו כאן כדי להצטרף</a></p>
    `.trim(),
  };
}

/**
 * Spec §5.5 trigger #3 -- "meeting confirmed" (spec §3 step 8). Sent once,
 * on the same transaction that flips the meeting to `closed` -- by then
 * every still-in participant has approved, by construction
 * (`allStillInHaveApproved`), so there is no separate "who approved"
 * question to ask here.
 */
export function meetingConfirmedEmail(meetingId: string): EmailContent {
  const link = `${appBaseUrl()}/meetings/${meetingId}`;

  return {
    subject: "הפגישה שלך אושרה!",
    html: `
      <p>שלום,</p>
      <p>כל מי שעדיין בעניין אישר -- הפגישה סגורה ומאושרת.</p>
      <p><a href="${link}">לחצו כאן לפרטים</a></p>
    `.trim(),
  };
}

/**
 * Spec §5.5 trigger #4 -- a meeting returned to weighing because someone's
 * approval elsewhere conflicted with it (spec §5.7,
 * `cancelConflictingMeetings`). Sent to whoever is still in *this*
 * meeting -- the person whose approval caused the cancellation already has
 * their own Response on it set to `cant_make_it` by the time this fires,
 * so the standard "still in" filter excludes them without any extra
 * parameter.
 */
export function conflictReweighEmail(meetingId: string): EmailContent {
  const link = `${appBaseUrl()}/meetings/${meetingId}`;

  return {
    subject: "הפגישה שלך חוזרת לשקילה",
    html: `
      <p>שלום,</p>
      <p>אחד המשתתפים אישר פגישה אחרת שמתנגשת עם הזמן שהוצע כאן, אז הפגישה חוזרת לשקילה מחדש.</p>
      <p><a href="${link}">לחצו כאן למעקב</a></p>
    `.trim(),
  };
}

/**
 * Spec §5.5 trigger #5 -- `stuck` (spec §3.1's cycle cap reached with no
 * agreement). Fired from two independent places -- `respondToMeeting`
 * reaching the cap, and `runCycle` catching `NoSolutionError` -- see
 * `lib/email/notify.ts`'s `notifyStuck` for why one template still covers
 * both.
 */
export function stuckEmail(meetingId: string): EmailContent {
  const link = `${appBaseUrl()}/meetings/${meetingId}`;

  return {
    subject: "לא נמצא זמן שמתאים לכולם",
    html: `
      <p>שלום,</p>
      <p>לא הצלחנו למצוא זמן שמתאים לכל מי שעדיין בעניין -- הכי טוב שנמצא מוצג בפגישה, וצריך הכרעה ידנית של הקבוצה.</p>
      <p><a href="${link}">לחצו כאן לפרטים</a></p>
    `.trim(),
  };
}

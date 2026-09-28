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
 * Only `proposalWaitingEmail` exists yet -- B8 part one wires just the one
 * trigger. The other four (invitation, meeting confirmed, conflict
 * re-weigh, stuck) are B8 part two, each getting its own function here
 * when that part is built.
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

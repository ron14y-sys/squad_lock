/**
 * B12's smoke test: one real email through Resend, to one address you name.
 *
 *   npm run verify:b12 -- you@example.com
 *
 * ## What it proves, and what it does not
 *
 * It proves that `RESEND_API_KEY` is valid and that `lib/email/client.ts`
 * reaches Resend and gets an id back. It spends exactly one email of the
 * free tier (3,000/month, 100/day) and touches nothing else: no database,
 * no groups, no meetings, no `NotificationLog` row.
 *
 * **Until a domain is verified (B12 proper), the recipient must be the
 * address your Resend account was created with.** With
 * `RESEND_FROM_ADDRESS="SquadLock <onboarding@resend.dev>"`, Resend answers
 * any other recipient with a 403 -- that is the rule working, not a bug. The
 * acceptance line "does not land in spam" is also not really testable
 * before the domain is verified, since `resend.dev` is Resend's own shared
 * sender; run this again from the real address once B12 is done.
 *
 * Reads `RESEND_API_KEY` and `RESEND_FROM_ADDRESS` from `.env.local`.
 */

import { sendEmail } from "@/lib/email/client";

const recipient = process.argv[2];

if (!recipient || !recipient.includes("@")) {
  console.error("Usage: npm run verify:b12 -- you@example.com");
  process.exit(1);
}

async function main(): Promise<void> {
  const from = process.env.RESEND_FROM_ADDRESS ?? "(unset)";
  console.log(`Sending one email from ${from} to ${recipient} ...`);

  try {
    const { id } = await sendEmail({
      to: recipient,
      subject: "SquadLock — B12 test email",
      html: "<p>If you are reading this, Resend is wired up correctly.</p>",
    });
    console.log(`Sent. Resend id: ${id}`);
    console.log("Now check the inbox -- and the spam folder.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    if (error instanceof Error && error.message.includes("(403)")) {
      console.error(
        "\nA 403 from resend.dev usually means the recipient is not the " +
          "address your Resend account was created with. Without a verified " +
          "domain, that is the only address it will send to."
      );
    }
    process.exit(1);
  }
}

void main();

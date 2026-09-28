/**
 * B8 -- the Resend transactional-email client (spec §5.5, §6.3 #4).
 *
 * Same shape as `lib/places/client.ts`: a thin `fetch` wrapper, no domain
 * logic, no SDK dependency. What "domain logic" means here belongs to
 * `lib/email/notify.ts` instead -- which recipients, which template, what
 * happens on failure. This file only knows how to hand Resend one already-
 * built email and report whether it went out.
 *
 * Resend is spec §13.8's "leading candidate," not a final decision -- if
 * the provider ever changes, this is the one file that has to.
 */

const SEND_ENDPOINT = "https://api.resend.com/emails";

type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
};

type SendEmailResult = {
  id: string;
};

type ResendSendResponse = {
  id: string;
};

function apiKeyHeader(): Record<string, string> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error("RESEND_API_KEY is not set -- see .env.example.");
  }
  return { Authorization: `Bearer ${key}` };
}

/** Throws loudly rather than silently mailing from an empty address. */
function fromAddress(): string {
  const from = process.env.RESEND_FROM_ADDRESS;
  if (!from) {
    throw new Error("RESEND_FROM_ADDRESS is not set -- see .env.example.");
  }
  return from;
}

/**
 * Sends one email through Resend's API, or throws. Never call this
 * directly outside `lib/email/notify.ts` -- that is the layer that catches
 * the throw, logs it to `NotificationLog`, and guarantees a failed send
 * never propagates into whatever triggered it (spec §5.5's binding rule:
 * notification is not part of meeting state).
 */
export async function sendEmail(
  input: SendEmailInput
): Promise<SendEmailResult> {
  const response = await fetch(SEND_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...apiKeyHeader(),
    },
    body: JSON.stringify({
      from: fromAddress(),
      to: input.to,
      subject: input.subject,
      html: input.html,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`email: send failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as ResendSendResponse;
  return { id: data.id };
}

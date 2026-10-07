/**
 * B6b — the Google Calendar free/busy client (spec §5.2, §5.4).
 *
 * The one place in this project that talks to Google Calendar, same
 * division of labour as A1's Gemini client: a thin wrapper, no domain logic,
 * nothing here decides *when* to call it — only how. Plain `fetch`, not the
 * `googleapis` SDK — that package is not a dependency of this project and
 * two REST calls do not earn one.
 *
 * Two calls, always in this order:
 *
 * 1. Exchange the stored refresh token for a short-lived access token
 *    (`oauth2.googleapis.com/token`).
 * 2. Call `freebusy.query` with that access token over the caller's window.
 *
 * **No retry here.** A failed call throws, and B9 ("Retry and error handling
 * on external calls") is the task that decides what happens next — logging,
 * backoff, surfacing to the user. Folding that in here would duplicate a
 * decision B9 has to make consistently across every external call, not just
 * this one.
 * The one thing this file does classify is a rate limit: that throws the shared
 * `ExternalRateLimitError` (B9 part four), so `runCycle` can back off instead
 * of retrying on the flat cooldown.
 *
 * **Takes a refresh token, not a `userId`.** This file never touches the
 * database — whoever assembles a meeting's `Participant[]` is the one place
 * that reads `User.googleRefreshToken` and calls this. That keeps the
 * network call testable with nothing but a mocked `fetch`.
 */

import {
  ExternalRateLimitError,
  retryAfterMsOf,
} from "@/lib/external/rate-limit";
import type { TimeSlot } from "@/lib/types";

/**
 * The refresh token was rejected — revoked, or expired. Distinct from a
 * transient network failure: `calendar.freebusy` is confirmed non-sensitive
 * (spec §6.3, decision D13), and the app publishes **In production** —
 * so this is not the Testing-mode 7-day expiry (that branch of B10/#34
 * never applied here). It is ordinary housekeeping: a user revoked access,
 * or Google invalidated the token for some other reason. A caller sees this
 * and knows the fix is "sign in again", not "try again in a minute".
 *
 * This file only ever sees a raw token, never a user: whoever maps tokens
 * back to users (`lib/calendar/participant-busy.ts`) says whose it was.
 */
export class CalendarAuthError extends Error {
  constructor(detail: string) {
    super(`calendar: ${detail}`);
    this.name = "CalendarAuthError";
  }
}

/**
 * The `reason` strings Google's Calendar API puts in a 403 for a quota or
 * rate wall, as opposed to `forbidden` and friends (a real permission
 * problem, which retrying never fixes -- but also nothing to back off from).
 */
const CALENDAR_RATE_LIMIT_REASON =
  /rateLimitExceeded|userRateLimitExceeded|dailyLimitExceeded|quotaExceeded/i;

/** A 403 because the token was granted without `calendar.freebusy`. */
const CALENDAR_SCOPE_MISSING = /ACCESS_TOKEN_SCOPE_INSUFFICIENT/;

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const FREEBUSY_ENDPOINT = "https://www.googleapis.com/calendar/v3/freeBusy";

/** Exchanges a stored refresh token for a short-lived access token. */
async function getAccessToken(refreshToken: string): Promise<string> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_OAUTH_SECRET ?? "",
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    // Google's token endpoint answers a bad or revoked refresh token with
    // `invalid_grant` in the body, but any non-2xx here is this person's
    // consent gone stale — there is no other reason this call fails.
    const body = await response.text();
    throw new CalendarAuthError(
      `token exchange failed (${response.status}): ${body}`
    );
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new CalendarAuthError("token exchange returned no access_token");
  }
  return data.access_token;
}

type FreeBusyResponse = {
  calendars?: Record<string, { busy?: { start: string; end: string }[] }>;
};

/**
 * This person's busy blocks on their primary calendar, over `window`.
 *
 * `calendar.freebusy` is scoped to free/busy only (spec §5.2) — nothing
 * about what a block *is* ever reaches this app, which is why the request
 * asks for exactly one calendar (`primary`) and the response is trimmed to
 * `{ start, end }` on the way out.
 */
export async function fetchBusy(
  refreshToken: string,
  window: TimeSlot
): Promise<TimeSlot[]> {
  const accessToken = await getAccessToken(refreshToken);

  const response = await fetch(FREEBUSY_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin: window.start.toISOString(),
      timeMax: window.end.toISOString(),
      items: [{ id: "primary" }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    const message = `calendar: freebusy.query failed (${response.status}): ${body}`;
    // B9 part four: Google answers a rate limit with 429, or with a 403
    // whose body names the reason -- the 403 is also what a genuine
    // permission problem looks like, so only the named reasons count.
    if (response.status === 429 || CALENDAR_RATE_LIMIT_REASON.test(body)) {
      throw new ExternalRateLimitError(
        "calendar",
        message,
        retryAfterMsOf(response)
      );
    }
    // Google's consent screen lets a person sign in with the calendar box
    // unticked: the token exchanges fine, then every query is refused.
    // Retrying never fixes it — the fix is consenting again, same as a
    // revoked token — so it is the same error.
    if (response.status === 403 && CALENDAR_SCOPE_MISSING.test(body)) {
      throw new CalendarAuthError(message.replace(/^calendar: /, ""));
    }
    throw new Error(message);
  }

  const data = (await response.json()) as FreeBusyResponse;
  const busy = data.calendars?.primary?.busy ?? [];

  return busy.map((block) => ({
    start: new Date(block.start),
    end: new Date(block.end),
  }));
}

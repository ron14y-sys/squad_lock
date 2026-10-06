/**
 * B9 part four -- one shared signal for "the other side said slow down".
 *
 * `lib/calendar/freebusy.ts` and `lib/places/client.ts` used to throw one
 * generic `Error` for every non-2xx answer, so `runCycle`'s fault branch
 * could not tell a quota wall from a bug and retried both every 90 seconds.
 * Gemini already had its own answer (`LlmCallError.rateLimited`,
 * `retryDelayMs`); this is the same idea for the two HTTP clients, kept in
 * one place so Calendar and Places agree on what "rate-limited" means and
 * how long to wait.
 *
 * Only the *signal* lives here. What to do about it -- the cooldown written
 * to `Meeting.retryNotBefore` -- is `run-cycle.ts`'s `faultRetryNotBefore`.
 */

export type RateLimitedService = "calendar" | "places";

/**
 * The service answered "too many requests". `retryAfterMs` is the service's
 * own `Retry-After`, when it sent one: its number beats any default we
 * invent, same rule as `retryDelayMs` for Gemini.
 */
export class ExternalRateLimitError extends Error {
  constructor(
    public readonly service: RateLimitedService,
    message: string,
    public readonly retryAfterMs: number | null
  ) {
    super(message);
    this.name = "ExternalRateLimitError";
  }
}

/** A hostile or buggy header must not park a meeting for weeks. */
export const MAX_RETRY_AFTER_MS = 24 * 60 * 60_000;

/**
 * `Retry-After` is either whole seconds or an HTTP date (RFC 9110 §10.2.3).
 * `null` for anything else, including a missing header, a negative number
 * or a date already in the past.
 */
export function parseRetryAfterMs(
  header: string | null | undefined,
  now: Date = new Date()
): number | null {
  if (!header) return null;
  const value = header.trim();

  let ms: number;
  if (/^\d+$/.test(value)) {
    ms = Number(value) * 1000;
  } else {
    const date = Date.parse(value);
    if (Number.isNaN(date)) return null;
    ms = date - now.getTime();
  }

  if (!(ms > 0)) return null;
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}

/** Reads `Retry-After` off anything `Response`-shaped; tolerates a bare mock. */
export function retryAfterMsOf(response: {
  headers?: { get(name: string): string | null };
}): number | null {
  return parseRetryAfterMs(response.headers?.get("retry-after"));
}

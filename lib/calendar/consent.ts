// What a sign-in may store as the person's calendar connection.
//
// Google's consent screen shows the calendar permission as its own checkbox,
// so a person can sign in without ticking it. The refresh token then
// exchanges fine and every free/busy query is refused with a 403 — which,
// stored, looks like a working connection until a meeting gets stuck on it.
// Kept out of `auth.ts` so it is testable without loading Auth.js.

export const FREEBUSY_SCOPE =
  "https://www.googleapis.com/auth/calendar.freebusy";

/**
 * The value to write to `User.googleRefreshToken` after a sign-in:
 *
 * - `null` when Google lists the granted scopes and `calendar.freebusy` is
 *   not among them — clearing an older token too, so the app says "not
 *   connected" instead of failing quietly;
 * - the new refresh token when there is one;
 * - `undefined` (leave the stored one alone) when Google sent none.
 *
 * No `scope` at all is not read as "calendar refused": that would disconnect
 * everybody the day a library stopped passing it through.
 */
export function refreshTokenToStore(account: {
  scope?: string | null;
  refresh_token?: string | null;
}): string | null | undefined {
  if (account.scope && !account.scope.split(/\s+/).includes(FREEBUSY_SCOPE)) {
    return null;
  }
  return account.refresh_token ?? undefined;
}

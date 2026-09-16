/**
 * B6c — wiring `fetchBusy` to real users (spec §5.2, §5.4).
 *
 * Two layers, the same split `lib/db/match-run.ts` and
 * `__tests__/match-run-db.test.ts` already use for exactly this reason:
 *
 * - **`fetchBusyForConnections`** is the actual logic — who gets asked, in
 *   what order, what a missing or rejected connection means for the rest of
 *   the group. No database in it, so it is fully covered by a mocked
 *   `fetch`, the same way `freebusy.ts`'s own tests are.
 * - **`fetchBusyForUsers`** is the thin database-touching wrapper: look up
 *   `googleRefreshToken` for a set of users, hand the result to the layer
 *   above. Covered separately, against a real database, in
 *   `__tests__/participant-busy-db.test.ts`.
 *
 * **This is not "assemble a `Participant[]`".** A real `Participant` also
 * carries `profile`, `context` and `origin` — built by
 * `preferenceProfileFromRow` and `participantMeetingContextFromRow`, which
 * this file does not call. Whoever runs a matching pass composes all three;
 * this is only the calendar piece.
 */

import { getPrisma } from "@/lib/db/client";
import type { TimeSlot } from "@/lib/types";
import { fetchBusy } from "./freebusy";

/** Just enough of a `User` row for this file to do its job. */
export type CalendarConnection = {
  userId: string;
  googleRefreshToken: string | null;
};

/**
 * A participant with no refresh token on file at all — never signed in with
 * Google, or B2's sign-in upsert has not run for them yet. Distinct from
 * `CalendarAuthError` (`freebusy.ts`), which is a token that existed and was
 * rejected; this one never had a token to try.
 */
export class MissingCalendarConnectionError extends Error {
  constructor(userId: string) {
    super(`calendar: user ${userId} has no Google refresh token on file`);
    this.name = "MissingCalendarConnectionError";
  }
}

function requireToken(connection: CalendarConnection): string {
  if (!connection.googleRefreshToken) {
    throw new MissingCalendarConnectionError(connection.userId);
  }
  return connection.googleRefreshToken;
}

/**
 * Busy blocks for every connection, keyed by `userId`.
 *
 * **Fails whole, not partial, and fails before the first network call if it
 * is going to fail at all.** Every connection is checked for a token up
 * front — a missing one for the fifth person means the other four's
 * Calendar API calls never fire either. The alternative, treating a missing
 * or rejected connection as "assume free", is the one mistake spec §5.7
 * calls out by name for the conflict check: a false positive here is worse
 * than a false negative, because the failure mode is a proposal that
 * collides with a calendar nobody actually read.
 *
 * A rejected connection (`CalendarAuthError`, mid-flight) fails the same
 * way: `Promise.all` rejects on the first one, and whatever this was
 * computing for does not get a partial answer to work from.
 */
export async function fetchBusyForConnections(
  connections: CalendarConnection[],
  window: TimeSlot
): Promise<Map<string, TimeSlot[]>> {
  const tokensByUser = connections.map(
    (connection) => [connection.userId, requireToken(connection)] as const
  );

  const results = await Promise.all(
    tokensByUser.map(async ([userId, token]) => {
      const busy = await fetchBusy(token, window);
      return [userId, busy] as const;
    })
  );

  return new Map(results);
}

/**
 * `fetchBusyForConnections`, but looking the connections up in the database
 * first. The one place this file touches Postgres.
 */
export async function fetchBusyForUsers(
  userIds: string[],
  window: TimeSlot
): Promise<Map<string, TimeSlot[]>> {
  const prisma = getPrisma();

  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, googleRefreshToken: true },
  });
  const tokenByUserId = new Map(
    users.map((user) => [user.id, user.googleRefreshToken])
  );

  // A userId with no matching row at all (shouldn't happen — the caller's
  // own list should come from real memberships) reads the same as "no
  // token": nothing this file can hand `fetchBusy`, so `requireToken` raises
  // for it the same way.
  const connections: CalendarConnection[] = userIds.map((userId) => ({
    userId,
    googleRefreshToken: tokenByUserId.get(userId) ?? null,
  }));

  return fetchBusyForConnections(connections, window);
}

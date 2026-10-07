/**
 * B6c — wiring `fetchBusy` to real users (spec §5.2, §5.4).
 *
 * Two layers, the same split `lib/db/match-run.ts` and
 * `__tests__/match-run-db.test.ts` already use for exactly this reason:
 *
 * - **`fetchBusyForConnections`** is the actual logic — who gets asked, in
 *   what order, what a missing or rejected connection means for the rest of
 *   the group (nothing: it is reported, not fatal). No database in it, so it is fully covered by a mocked
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
import { CalendarAuthError, fetchBusy } from "./freebusy";

/** Just enough of a `User` row for this file to do its job. */
export type CalendarConnection = {
  userId: string;
  googleRefreshToken: string | null;
};

/**
 * What reading a group's calendars came back with.
 *
 * - `busy` — the blocks of everyone whose calendar was read.
 * - `unread` — whoever's calendar was not: no token on file, or a token
 *   Google refused. They are left out of `busy`, so a run treats them as
 *   free apart from the hours they set by hand.
 * - `rejected` — the part of `unread` whose token was refused (B10), so the
 *   caller can clear it and ask the person to reconnect.
 */
export type CalendarRead = {
  busy: Map<string, TimeSlot[]>;
  unread: string[];
  rejected: string[];
};

/**
 * Busy blocks for every connection that can be read.
 *
 * **A calendar is optional.** Someone who never connected one, or whose
 * token Google refused, does not hold up the rest of the group: they come
 * back in `unread` and the run goes on without their calendar. That is the
 * opposite of what B6 first decided (refuse the whole group, because a
 * proposal could collide with a calendar nobody read). The collision risk
 * is real, so it is not hidden: the proposal names whose calendar was not
 * checked (`run-cycle.ts` stores it, the meeting page shows it), and that
 * person still has to approve the time themselves.
 *
 * Anything else — a rate limit, a 5xx, the network — still fails the whole
 * read: `Promise.all` rejects on the first one and the run is retried. A
 * passing outage says nothing about whether someone is free.
 */
export async function fetchBusyForConnections(
  connections: CalendarConnection[],
  window: TimeSlot
): Promise<CalendarRead> {
  const refused = new Set<string>();

  const results = await Promise.all(
    connections.map(async ({ userId, googleRefreshToken }) => {
      if (!googleRefreshToken) return null;
      try {
        return [userId, await fetchBusy(googleRefreshToken, window)] as const;
      } catch (error) {
        // B10: `freebusy.ts` never knows whose token it was handed — this is
        // the one place that does.
        if (error instanceof CalendarAuthError) {
          refused.add(userId);
          return null;
        }
        throw error;
      }
    })
  );

  const busy = new Map(results.filter((entry) => entry !== null));
  // In the order the connections came in, so a list of names reads the same
  // on every run.
  const ids = connections.map((connection) => connection.userId);
  return {
    busy,
    unread: ids.filter((id) => !busy.has(id)),
    rejected: ids.filter((id) => refused.has(id)),
  };
}

/**
 * `fetchBusyForConnections`, but looking the connections up in the database
 * first. The one place this file touches Postgres.
 */
export async function fetchBusyForUsers(
  userIds: string[],
  window: TimeSlot
): Promise<CalendarRead> {
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
  // token": nothing this file can hand `fetchBusy`, so it comes back unread.
  const connections: CalendarConnection[] = userIds.map((userId) => ({
    userId,
    googleRefreshToken: tokenByUserId.get(userId) ?? null,
  }));

  return fetchBusyForConnections(connections, window);
}

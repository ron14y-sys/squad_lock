/**
 * #213: what this group has already been offered lately.
 *
 * Venue choice is deterministic — the same pool, the same group and the same
 * free evening give the same ranked list, and so the same rank 1, every time
 * a meeting is made. Nothing remembered what the group had been shown.
 *
 * This is the memory, and only the memory: the venues that were the top
 * proposal of another meeting of the same group in the last `RECENT_VENUE_DAYS`.
 * It never removes a venue (it is advice to the model that a different one is
 * welcome, see the prompt in `agent.ts`), so a small group in a quiet
 * neighbourhood still gets an answer.
 *
 * A proposal counts whether or not it was accepted. The group *saw* it, and
 * seeing the same bar offered twice is the complaint. What the group actually
 * went to is a different, stricter question, kept for a later ticket.
 */

/** How far back "lately" reaches. Tunable; Ron owns the product answer. */
export const RECENT_VENUE_DAYS = 30;

/** At most this many names go to the model — a hint, not a ledger. */
export const RECENT_VENUES_SHOWN = 8;

export type RecentVenue = { placeId: string; name: string };

/** The slice of a past meeting this needs: rank 1 of each of its runs. */
export type PastMeeting = {
  matchRuns: {
    createdAt: Date;
    options: { venuePlaceId: string | null; venueName: string }[];
  }[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** The earliest a run may be and still count as recent. */
export function recentSince(now: Date, days = RECENT_VENUE_DAYS): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

/**
 * Newest first, one entry per place, capped at `RECENT_VENUES_SHOWN`.
 * A venue with no `placeId` (a free-text pin that was never resolved) cannot
 * be matched against the pool, so it is left out.
 */
export function recentVenuesOf(
  meetings: readonly PastMeeting[],
  now: Date,
  days = RECENT_VENUE_DAYS
): RecentVenue[] {
  const since = recentSince(now, days).getTime();
  const runs = meetings
    .flatMap((meeting) => meeting.matchRuns)
    .filter((run) => run.createdAt.getTime() >= since)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const seen = new Set<string>();
  const venues: RecentVenue[] = [];
  for (const run of runs) {
    for (const option of run.options) {
      if (!option.venuePlaceId || seen.has(option.venuePlaceId)) continue;
      seen.add(option.venuePlaceId);
      venues.push({ placeId: option.venuePlaceId, name: option.venueName });
    }
  }
  return venues.slice(0, RECENT_VENUES_SHOWN);
}

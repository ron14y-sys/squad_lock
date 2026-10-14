/**
 * #213: variety across a group's meetings.
 *
 * Venue choice is deterministic — the same pool, the same group and the same
 * free evening give the same ranked list, and so the same rank 1, every time
 * a meeting is made. So a venue the group has lately been to is held back
 * from the model **when there is somewhere else nearly as fair**
 * (`withoutVisited`); when there is not, it stays, so a small group in a
 * quiet neighbourhood still gets an answer. The venue the initiator named is
 * never held back: it was asked for.
 *
 * "Been to" is a meeting that closed — everyone approved it — dated in the
 * last `VISITED_VENUE_DAYS` or later. Its venue is rank 1 of its last run.
 * A proposal nobody approved does not count.
 */

import { MeetingStatus } from "@/lib/generated/prisma/enums";
import type { ViablePair } from "./constraints";
import type { CandidateScore } from "./distance";

/** How far back "lately" reaches. Tunable; Ron owns the product answer. */
export const VISITED_VENUE_DAYS = 30;

/** Another meeting of the group, as `assembleRun` reads it: runs oldest first. */
export type GroupMeeting = {
  status: MeetingStatus;
  currentDatetime: Date | null;
  matchRuns: { options: { venuePlaceId: string | null }[] }[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** The venues of the group's closed meetings, from `VISITED_VENUE_DAYS` ago on. */
export function visitedVenues(
  meetings: readonly GroupMeeting[],
  now: Date
): Set<string> {
  const since = now.getTime() - VISITED_VENUE_DAYS * DAY_MS;
  return new Set(
    meetings
      .filter(
        (meeting) =>
          meeting.status === MeetingStatus.closed &&
          meeting.currentDatetime !== null &&
          meeting.currentDatetime.getTime() >= since
      )
      .flatMap((meeting) => meeting.matchRuns.at(-1)?.options ?? [])
      .flatMap((option) => (option.venuePlaceId ? [option.venuePlaceId] : []))
  );
}

/**
 * How much worse an alternative may be for its worst-off person than the
 * visited venue was, in burden — a quarter of that person's range. Tunable;
 * Ron owns the product answer.
 */
export const VISITED_MARGIN = 0.25;

/**
 * Drops the visited venues, all but `keep`, from what the model may choose —
 * only when what is left has a venue nearly as fair: its worst-off burden
 * (`leximin[0]`) within everyone's range (1.0), or within `VISITED_MARGIN`
 * of the fairest visited venue's. The second is for a group that lives far
 * apart, where nothing is within everyone's range (Modiin, Ashdod and Ramat
 * Gan). Otherwise returns both lists unchanged.
 */
export function withoutVisited(
  ranked: CandidateScore[],
  viable: ViablePair[],
  visited: ReadonlySet<string>,
  keep: string | undefined
): { ranked: CandidateScore[]; viable: ViablePair[] } {
  const held = (placeId: string) => visited.has(placeId) && placeId !== keep;
  const left = ranked.filter((score) => !held(score.candidate.placeId));
  const visitedWorst = Math.min(
    ...ranked
      .filter((score) => held(score.candidate.placeId))
      .map((score) => score.leximin[0])
  );
  const bar = Math.max(1, visitedWorst + VISITED_MARGIN);
  if (!left.some((score) => score.leximin[0] <= bar)) return { ranked, viable };
  return {
    ranked: left,
    viable: viable.filter((pair) => !held(pair.candidatePlaceId)),
  };
}

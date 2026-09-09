// The group feed: per-viewer card status and the group's meeting list (C5,
// spec §5.6, issue #40). `MeetingCardStatusInput`/`MeetingCardStatus` are
// lib/types/meeting.ts's contract for this derivation; this file is the
// "whoever writes the feed query" that type's own comment points to.

import { meetingFromRow } from "@/lib/types/meeting-from-row";

import { findConflictingMeetings } from "./conflict-dismissal";
import { OPEN_MEETING_STATUSES } from "./meetings";
import { getPrisma } from "./client";

import type {
  Meeting,
  MeetingCardStatus,
  MeetingCardStatusInput,
  PinnedWhen,
  Response,
  ResponseStatus,
} from "@/lib/types/meeting";

/**
 * Per-viewer card status (spec §5.6's vocabulary): `waiting on you`,
 * `waiting on N others`, `re-weighing`, `conflicting`, `stuck`, `closed`.
 *
 * `conflicting` outranks everything else here because spec §5.7 requires it
 * to be impossible to miss before approving — a stuck or re-weighing meeting
 * that also conflicts still needs the warning. `cancelled` has no card
 * status of its own: the only place that value would be written, the
 * meeting is flipped straight back to `weighing` in the same transaction
 * (see `cancelConflictingMeetings` in `./meetings.ts`), so a stored
 * `cancelled` row is exactly as closed to further action as `closed` is.
 */
export function deriveMeetingCardStatus(
  input: MeetingCardStatusInput
): MeetingCardStatus {
  const { meeting, responses, viewerId, hasConflict } = input;

  if (meeting.status === "closed" || meeting.status === "cancelled") {
    return "closed";
  }
  if (hasConflict) return "conflicting";
  if (meeting.status === "stuck") return "stuck";
  if (meeting.status === "weighing") return "reweighing";

  // status === "awaiting": a proposal is out, so who is left is per-viewer.
  const viewerResponse = responses.find((r) => r.userId === viewerId);
  if (!viewerResponse || viewerResponse.status === "pending") {
    return "waiting_on_you";
  }
  return "waiting_on_others";
}

/**
 * One meeting as the feed shows it. Not the `MeetingCard` convenience type
 * in lib/types/meeting.ts: that type's `proposedSlot` is a `TimeSlot`
 * (start *and* end), and nothing in the schema stores a meeting's end time
 * yet — B6 hasn't shipped the slot the agent actually proposes, only
 * `currentDatetime`, a single instant (see that field's own comment on
 * `Meeting`). Inventing a duration here would be a guess this file has no
 * business making, so the card carries the instant it actually has.
 */
export type MeetingCardDTO = {
  id: string;
  status: MeetingCardStatus;
  /** Set only when `status` is `waiting_on_others`. */
  waitingOn: number | null;
  currentDatetime: string | null;
  pinnedWhen: PinnedWhen | null;
  pinnedVenue: string | null;
  occasion: string | null;
  createdAt: string;
  approvedCount: number;
  totalCount: number;
  /** True once `currentDatetime` has passed — the feed's "past" divider. */
  isPast: boolean;
  participants: { userId: string; name: string; status: ResponseStatus }[];
};

/** No proposal yet sorts as "now" — the newest, least-settled meetings lead the list. */
function sortKey(card: Pick<MeetingCardDTO, "currentDatetime">): number {
  return card.currentDatetime === null
    ? -Infinity
    : new Date(card.currentDatetime).getTime();
}

/**
 * Nearest-first, undated meetings leading (spec §5.6). Past meetings — which
 * always have a date, by definition of `isPast` — come after, most-recent
 * first; the feed renders the divider at the first `isPast` card rather than
 * this function returning two separate arrays.
 */
function sortMeetingCards(cards: MeetingCardDTO[]): MeetingCardDTO[] {
  const upcoming = cards
    .filter((c) => !c.isPast)
    .sort((a, b) => sortKey(a) - sortKey(b));
  const past = cards
    .filter((c) => c.isPast)
    .sort((a, b) => sortKey(b) - sortKey(a));
  return [...upcoming, ...past];
}

export async function listMeetingCardsForGroup(
  groupId: string,
  viewerId: string
): Promise<{ meetings: MeetingCardDTO[]; openCount: number }> {
  const prisma = getPrisma();

  const rows = await prisma.meeting.findMany({
    where: { groupId },
    include: { responses: { include: { user: { select: { name: true } } } } },
  });

  const conflictPairs = await findConflictingMeetings(viewerId);
  const conflictingIds = new Set<string>();
  for (const pair of conflictPairs) {
    conflictingIds.add(pair.meetingA.id);
    conflictingIds.add(pair.meetingB.id);
  }

  const openCount = rows.filter((row) =>
    (OPEN_MEETING_STATUSES as string[]).includes(row.status)
  ).length;

  const now = Date.now();

  const cards: MeetingCardDTO[] = rows.map((row) => {
    const meeting: Meeting = meetingFromRow(row);
    const responses: Response[] = row.responses.map((r) => ({
      id: r.id,
      meetingId: r.meetingId,
      userId: r.userId,
      status: r.status,
      reasonText: r.reasonText,
      respondedAt: r.respondedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));

    const status = deriveMeetingCardStatus({
      meeting,
      responses,
      viewerId,
      hasConflict: conflictingIds.has(meeting.id),
    });

    const pendingCount = responses.filter((r) => r.status === "pending").length;
    const approvedCount = responses.filter(
      (r) => r.status === "approved"
    ).length;

    return {
      id: meeting.id,
      status,
      waitingOn: status === "waiting_on_others" ? pendingCount : null,
      currentDatetime: meeting.currentDatetime?.toISOString() ?? null,
      pinnedWhen: meeting.pinnedWhen,
      pinnedVenue: meeting.pinnedVenue,
      occasion: meeting.occasion,
      createdAt: meeting.createdAt.toISOString(),
      approvedCount,
      totalCount: responses.length,
      isPast:
        meeting.currentDatetime !== null &&
        meeting.currentDatetime.getTime() < now,
      participants: row.responses.map((r) => ({
        userId: r.userId,
        name: r.user.name,
        status: r.status,
      })),
    };
  });

  return { meetings: sortMeetingCards(cards), openCount };
}

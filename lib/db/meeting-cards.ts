// The group feed: per-viewer card status and the group's meeting list (C5,
// spec §5.6, issue #40). `MeetingCardStatusInput`/`MeetingCardStatus` are
// lib/types/meeting.ts's contract for this derivation; this file is the
// "whoever writes the feed query" that type's own comment points to.

import { meetingFromRow } from "@/lib/types/meeting-from-row";

import { findConflictingMeetings } from "./conflict-dismissal";
import { OPEN_MEETING_STATUSES } from "./meetings";
import { getPrisma } from "./client";

import type { MeetingStatus, RunStage } from "@/lib/generated/prisma/enums";
import type {
  MeetingModel,
  ResponseModel,
} from "@/lib/generated/prisma/models";
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
  /**
   * The venue of the proposal on the table (rank 1 of the latest run), or
   * `null` before there is one. What a card says once there is a proposal:
   * `pinnedVenue` is only what was asked for, and the run may have put the
   * meeting somewhere else (#212).
   */
  proposedVenue: string | null;
  occasion: string | null;
  createdAt: string;
  approvedCount: number;
  totalCount: number;
  /** True once `currentDatetime` has passed — the feed's "past" divider. */
  isPast: boolean;
  /** Where the run weighing it is, while one is (#155). */
  runStage: RunStage | null;
  /**
   * `reweighing` with no run behind it yet: the opening search, not a
   * re-weighing. Same status — same fast poll — but it must not be called
   * "re-weighed" when nothing has been weighed.
   */
  firstSearch: boolean;
  participants: { userId: string; name: string; status: ResponseStatus }[];
};

/**
 * A meeting's run stage, as far as a screen should believe it (#155): only
 * while it is `weighing`. A run killed mid-stage leaves its stage on the row
 * until the retry overwrites it, and a meeting that has moved on is not
 * being worked on, whatever the row says.
 */
export function runStageOf(row: {
  status: MeetingStatus;
  runStage: RunStage | null;
}): RunStage | null {
  return row.status === "weighing" ? row.runStage : null;
}

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
function sortMeetingCards<T extends MeetingCardDTO>(cards: T[]): T[] {
  const upcoming = cards
    .filter((c) => !c.isPast)
    .sort((a, b) => sortKey(a) - sortKey(b));
  const past = cards
    .filter((c) => c.isPast)
    .sort((a, b) => sortKey(b) - sortKey(a));
  return [...upcoming, ...past];
}

type MeetingRowWithResponses = MeetingModel & {
  responses: (ResponseModel & { user: { name: string } })[];
  _count: { matchRuns: number };
  /** The latest run only, and only its first option (#212). */
  matchRuns: { options: { venueName: string }[] }[];
};

/**
 * What the cards need of the latest run, and nothing more: its first option's
 * venue, to name where the meeting actually is (#212).
 */
const LATEST_PROPOSAL_VENUE = {
  orderBy: { cycleNumber: "desc" },
  take: 1,
  select: {
    options: { where: { rank: 1 }, take: 1, select: { venueName: true } },
  },
} as const;

/** One meeting row → the card the feed and the all-groups timeline both draw. */
function toMeetingCardDTO(
  row: MeetingRowWithResponses,
  viewerId: string,
  conflictingIds: Set<string>,
  now: number
): MeetingCardDTO {
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
  const approvedCount = responses.filter((r) => r.status === "approved").length;

  return {
    id: meeting.id,
    status,
    waitingOn: status === "waiting_on_others" ? pendingCount : null,
    currentDatetime: meeting.currentDatetime?.toISOString() ?? null,
    pinnedWhen: meeting.pinnedWhen,
    pinnedVenue: meeting.pinnedVenue,
    proposedVenue: row.matchRuns[0]?.options[0]?.venueName ?? null,
    occasion: meeting.occasion,
    createdAt: meeting.createdAt.toISOString(),
    approvedCount,
    totalCount: responses.length,
    isPast:
      meeting.currentDatetime !== null &&
      meeting.currentDatetime.getTime() < now,
    runStage: runStageOf(row),
    firstSearch: status === "reweighing" && row._count.matchRuns === 0,
    participants: row.responses.map((r) => ({
      userId: r.userId,
      name: r.user.name,
      status: r.status,
    })),
  };
}

async function conflictingMeetingIds(viewerId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const pair of await findConflictingMeetings(viewerId)) {
    ids.add(pair.meetingA.id);
    ids.add(pair.meetingB.id);
  }
  return ids;
}

export async function listMeetingCardsForGroup(
  groupId: string,
  viewerId: string
): Promise<{ meetings: MeetingCardDTO[]; openCount: number }> {
  const prisma = getPrisma();

  const rows = await prisma.meeting.findMany({
    where: { groupId },
    include: {
      responses: { include: { user: { select: { name: true } } } },
      _count: { select: { matchRuns: true } },
      matchRuns: LATEST_PROPOSAL_VENUE,
    },
  });

  const conflictingIds = await conflictingMeetingIds(viewerId);
  const openCount = rows.filter((row) =>
    (OPEN_MEETING_STATUSES as string[]).includes(row.status)
  ).length;

  const now = Date.now();
  const cards = rows.map((row) =>
    toMeetingCardDTO(row, viewerId, conflictingIds, now)
  );

  return { meetings: sortMeetingCards(cards), openCount };
}

/** A card plus which group it lives in — the all-groups timeline mixes groups. */
export type AllGroupsCardDTO = MeetingCardDTO & {
  groupId: string;
  groupName: string;
};

/**
 * Every open meeting this viewer is a participant in, across every group
 * (spec §5.6 "All groups"): the source for the per-group "what awaits you"
 * counts and the single cross-group timeline. Only open meetings — a closed
 * one is history, and the group's own feed is where that lives.
 */
export async function listOpenMeetingCardsForUser(
  viewerId: string
): Promise<{ meetings: AllGroupsCardDTO[] }> {
  const prisma = getPrisma();

  const myResponses = await prisma.response.findMany({
    where: {
      userId: viewerId,
      meeting: { status: { in: OPEN_MEETING_STATUSES } },
    },
    include: {
      meeting: {
        include: {
          group: { select: { id: true, name: true } },
          responses: { include: { user: { select: { name: true } } } },
          _count: { select: { matchRuns: true } },
          matchRuns: LATEST_PROPOSAL_VENUE,
        },
      },
    },
  });

  const conflictingIds = await conflictingMeetingIds(viewerId);
  const now = Date.now();

  const cards: AllGroupsCardDTO[] = myResponses.map(({ meeting }) => ({
    ...toMeetingCardDTO(meeting, viewerId, conflictingIds, now),
    groupId: meeting.group.id,
    groupName: meeting.group.name,
  }));

  return { meetings: sortMeetingCards(cards) };
}

// One meeting in full — the three blocks (C6, spec §5.6, issue #42): the
// current proposal, where it stands, and what happened so far. B11 (which
// will call `persistMatchRun`) hasn't shipped, so no meeting has a real
// `MatchRun` yet — this reads whatever exists and returns `proposal: null`
// otherwise, the same forward-compatible shape `meeting-cards.ts` already
// uses for `currentDatetime`.

import { meetingFromRow } from "@/lib/types/meeting-from-row";

import { deriveMeetingCardStatus } from "./meeting-cards";
import { findConflictingMeetings } from "./conflict-dismissal";
import { CYCLE_CAP } from "./meetings";
import { getPrisma } from "./client";

import type { UnverifiedFact } from "@/lib/matching/constraints";
import type {
  Meeting,
  MeetingCardStatus,
  ResponseStatus,
} from "@/lib/types/meeting";

export type ParticipantDTO = {
  userId: string;
  name: string;
  status: ResponseStatus;
  respondedAt: string | null;
};

export type ProposalDTO = {
  venueName: string;
  venueAddress: string | null;
  start: string;
  end: string;
  /** This viewer's own reason, and only this viewer's — never a comparison. */
  justification: string | null;
  unverified: UnverifiedFact[];
  /** Ranks 2 and 3 — "we also considered X and Y" (spec §4.1c). */
  alsoConsidered: string[];
};

export type TimelineEvent =
  | { kind: "initiated"; at: string; by: string }
  | {
      kind: "proposed";
      at: string;
      cycleNumber: number;
      venueName: string;
      reweighedBecause: string | null;
    }
  | {
      kind: "response";
      at: string;
      by: string;
      status: ResponseStatus;
      reasonText: string | null;
    };

/** The other side of a clash — enough to say what approving here would undo. */
export type ConflictDTO = {
  meetingId: string;
  groupName: string;
  venueName: string | null;
  start: string | null;
};

export type MeetingDetailDTO = {
  id: string;
  groupId: string;
  status: MeetingCardStatus;
  /** So the client can find its own row in `participants` without a session hook. */
  viewerId: string;
  /** Cycles left before the meeting goes `stuck` — shown before "something doesn't work" spends one. */
  remainingCycles: number;
  /** Undismissed clashes with this viewer's other open meetings (spec §5.7). */
  conflicts: ConflictDTO[];
  initiatorName: string;
  pinnedVenue: string | null;
  occasion: string | null;
  proposal: ProposalDTO | null;
  participants: ParticipantDTO[];
  approvedCount: number;
  totalCount: number;
  timeline: TimelineEvent[];
};

/** A row's own words, for the one line the timeline says triggered a re-run. */
function describeContext(context: {
  note: string | null;
  originLabel: string | null;
  mobilityWindows: unknown;
}): string {
  if (context.note) return context.note;
  if (context.originLabel) return `מגיע/ה מ${context.originLabel}`;
  const windows = Array.isArray(context.mobilityWindows)
    ? (context.mobilityWindows as { mode?: string; available?: boolean }[])
    : [];
  const first = windows[0];
  if (first?.mode && first.available === false) return `אין ${first.mode} הערב`;
  return "המצב הערב שונה";
}

export async function getMeetingDetail(
  meetingId: string,
  viewerId: string
): Promise<MeetingDetailDTO | null> {
  const prisma = getPrisma();

  const row = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: {
      initiator: { select: { name: true } },
      responses: { include: { user: { select: { name: true } } } },
      matchRuns: {
        orderBy: { cycleNumber: "asc" },
        include: {
          options: { orderBy: { rank: "asc" } },
          seenContexts: { select: { contextId: true } },
        },
      },
    },
  });
  if (!row) return null;

  const meeting: Meeting = meetingFromRow(row);

  const conflictPairs = await findConflictingMeetings(viewerId);
  const otherMeetingIds = conflictPairs.flatMap((pair) => {
    if (pair.meetingA.id === meeting.id) return [pair.meetingB.id];
    if (pair.meetingB.id === meeting.id) return [pair.meetingA.id];
    return [];
  });
  const hasConflict = otherMeetingIds.length > 0;

  const otherMeetings =
    otherMeetingIds.length === 0
      ? []
      : await prisma.meeting.findMany({
          where: { id: { in: otherMeetingIds } },
          include: {
            group: { select: { name: true } },
            matchRuns: {
              orderBy: { cycleNumber: "desc" },
              take: 1,
              include: { options: { where: { rank: 1 } } },
            },
          },
        });
  const conflicts: ConflictDTO[] = otherMeetings.map((other) => ({
    meetingId: other.id,
    groupName: other.group.name,
    venueName:
      other.matchRuns[0]?.options[0]?.venueName ?? other.pinnedVenue ?? null,
    start: other.currentDatetime?.toISOString() ?? null,
  }));

  const responses = row.responses.map((r) => ({
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
    hasConflict,
  });

  const latestRun = row.matchRuns[row.matchRuns.length - 1] ?? null;
  const topOption = latestRun?.options.find((o) => o.rank === 1) ?? null;

  const proposal: ProposalDTO | null = topOption
    ? {
        venueName: topOption.venueName,
        venueAddress: topOption.venueAddress,
        start: topOption.proposedDatetime.toISOString(),
        end: topOption.proposedEnd.toISOString(),
        justification:
          (
            topOption.participantJustifications as Record<string, string> | null
          )?.[viewerId] ?? null,
        unverified: (topOption.unverified as UnverifiedFact[] | null) ?? [],
        alsoConsidered: latestRun!.options
          .filter((o) => o.rank !== 1)
          .map((o) => o.venueName),
      }
    : null;

  const timeline: TimelineEvent[] = [
    {
      kind: "initiated",
      at: meeting.createdAt.toISOString(),
      by: row.initiator.name,
    },
  ];

  let previousSeen = new Set<string>();
  for (const run of row.matchRuns) {
    const seenNow = new Set(run.seenContexts.map((c) => c.contextId));
    const newContextIds = [...seenNow].filter((id) => !previousSeen.has(id));
    previousSeen = seenNow;

    let reweighedBecause: string | null = null;
    if (run.cycleNumber > 1 && newContextIds.length > 0) {
      const context = await prisma.participantMeetingContext.findUnique({
        where: { id: newContextIds[0] },
      });
      if (context) reweighedBecause = describeContext(context);
    }

    const top = run.options.find((o) => o.rank === 1);
    if (top) {
      timeline.push({
        kind: "proposed",
        at: run.createdAt.toISOString(),
        cycleNumber: run.cycleNumber,
        venueName: top.venueName,
        reweighedBecause,
      });
    }
  }

  for (const response of responses) {
    if (response.status === "pending" || !response.respondedAt) continue;
    const user = row.responses.find((r) => r.id === response.id)!.user;
    timeline.push({
      kind: "response",
      at: response.respondedAt.toISOString(),
      by: user.name,
      status: response.status,
      reasonText: response.reasonText,
    });
  }

  timeline.sort((a, b) => a.at.localeCompare(b.at));

  return {
    id: meeting.id,
    groupId: meeting.groupId,
    status,
    viewerId,
    remainingCycles: Math.max(0, CYCLE_CAP - meeting.cycleCount),
    conflicts,
    initiatorName: row.initiator.name,
    pinnedVenue: meeting.pinnedVenue,
    occasion: meeting.occasion,
    proposal,
    participants: row.responses.map((r) => ({
      userId: r.userId,
      name: r.user.name,
      status: r.status,
      respondedAt: r.respondedAt?.toISOString() ?? null,
    })),
    approvedCount: responses.filter((r) => r.status === "approved").length,
    totalCount: responses.length,
    timeline,
  };
}

// One meeting in full — the three blocks (C6, spec §5.6, issue #42): the
// current proposal, where it stands, and what happened so far. B11 (which
// will call `persistMatchRun`) hasn't shipped, so no meeting has a real
// `MatchRun` yet — this reads whatever exists and returns `proposal: null`
// otherwise, the same forward-compatible shape `meeting-cards.ts` already
// uses for `currentDatetime`.

import { meetingFromRow } from "@/lib/types/meeting-from-row";

import { deriveMeetingCardStatus, runStageOf } from "./meeting-cards";
import { findConflictingMeetings } from "./conflict-dismissal";
import { CYCLE_CAP } from "./meetings";
import { getPrisma } from "./client";
import { MOBILITY_MODE_LABELS } from "@/lib/format/hebrew-labels";

import type { RunStage } from "@/lib/generated/prisma/enums";
import type { UnverifiedFact } from "@/lib/matching/constraints";
import type { MobilityMode } from "@/lib/types/profile";
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
  venueType: string | null;
  venueSummary: string | null;
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

/** Someone the matching agent cannot place: no home point and no amendment for tonight. */
export type MissingHomeDTO = { userId: string; name: string };

export type MeetingDetailDTO = {
  id: string;
  groupId: string;
  status: MeetingCardStatus;
  /** So the client can find its own row in `participants` without a session hook. */
  viewerId: string;
  /** Cycles left before the meeting goes `stuck` — shown before "something doesn't work" spends one. */
  remainingCycles: number;
  /** The stored status is `stuck` — separate from `status`, because a clash outranks it on the card. */
  isStuck: boolean;
  /** Where the run weighing it is, while one is (#155). */
  runStage: RunStage | null;
  /** Whether the viewer started this meeting — the only one who can cancel it when stuck. */
  isInitiator: boolean;
  /** Undismissed clashes with this viewer's other open meetings (spec §5.7). */
  conflicts: ConflictDTO[];
  /**
   * Who has nowhere to be weighed from (#132). Only worked out for a meeting
   * with no proposal yet or a stuck one — the two places it explains
   * something — and empty otherwise.
   */
  missingHome: MissingHomeDTO[];
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
export function describeContext(context: {
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
  if (first?.mode && first.available === false) {
    const label =
      MOBILITY_MODE_LABELS[first.mode as MobilityMode] ?? first.mode;
    return `אין ${label} הערב`;
  }
  return "המצב הערב שונה";
}

/**
 * Mirrors what `originOf` needs: a person can be weighed if they have a home
 * point, or if they gave an origin for this one meeting (spec §5.7 — tonight's
 * amendment wins over home). A missing origin makes `runCycle` throw before it
 * searches, and that throw is not a `NoSolutionError`, so the meeting is left
 * waiting with no proposal rather than marked stuck — which is why the caller
 * asks for this in both states, not only the stuck one.
 */
async function findMissingHome(
  meetingId: string,
  people: MissingHomeDTO[]
): Promise<MissingHomeDTO[]> {
  const prisma = getPrisma();
  const userIds = people.map((p) => p.userId);

  const [profiles, amendments] = await Promise.all([
    prisma.preferenceProfile.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, homeLat: true, homeLng: true },
    }),
    prisma.participantMeetingContext.findMany({
      where: {
        meetingId,
        userId: { in: userIds },
        originLat: { not: null },
        originLng: { not: null },
      },
      select: { userId: true },
    }),
  ]);

  return withoutOrigin(people, profiles, amendments);
}

/** The decision itself, kept free of the database so it can be tested. */
export function withoutOrigin(
  people: MissingHomeDTO[],
  profiles: {
    userId: string;
    homeLat: number | null;
    homeLng: number | null;
  }[],
  amendments: { userId: string }[]
): MissingHomeDTO[] {
  const hasHome = new Set(
    profiles
      .filter((p) => p.homeLat !== null && p.homeLng !== null)
      .map((p) => p.userId)
  );
  const hasAmendment = new Set(amendments.map((a) => a.userId));

  return people.filter(
    (p) => !hasHome.has(p.userId) && !hasAmendment.has(p.userId)
  );
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
      // Every rejection, each with its own words and its own time. A
      // `Response` row is *updated*, so its `reasonText` and `respondedAt`
      // only ever hold the last one — see the note on `responses` in
      // docs/database-schema.md.
      participantContexts: {
        where: { NOT: { rejectionText: null } },
        orderBy: { createdAt: "asc" },
        include: { user: { select: { name: true } } },
      },
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
        venueType: topOption.venueType,
        venueSummary: topOption.venueSummary,
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

  const missingHome =
    proposal === null || row.status === "stuck"
      ? await findMissingHome(
          meetingId,
          row.responses.map((r) => ({ userId: r.userId, name: r.user.name }))
        )
      : [];

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

  // Everything somebody said when rejecting, one event each. A person who
  // objected three times belongs in the timeline three times, at the three
  // moments they did it — those are the moments that caused the re-weighings
  // around them.
  const rejectionsByUser = new Map<string, number>();
  for (const context of row.participantContexts) {
    rejectionsByUser.set(
      context.userId,
      (rejectionsByUser.get(context.userId) ?? 0) + 1
    );
    timeline.push({
      kind: "response",
      at: context.createdAt.toISOString(),
      by: context.user.name,
      status: "doesnt_suit",
      reasonText: context.rejectionText,
    });
  }

  for (const response of responses) {
    if (response.status === "pending" || !response.respondedAt) continue;
    // A standing `doesnt_suit` is the newest rejection row, already above.
    // Any other status is a different fact and still belongs here: somebody
    // who objected and then approved the next proposal has to be shown
    // approving it.
    if (
      response.status === "doesnt_suit" &&
      rejectionsByUser.has(response.userId)
    ) {
      continue;
    }
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
    isStuck: row.status === "stuck",
    runStage: runStageOf(row),
    isInitiator: row.initiatorId === viewerId,
    conflicts,
    missingHome,
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

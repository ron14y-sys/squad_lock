// One meeting in full — the three blocks (C6, spec §5.6, issue #42): the
// current proposal, where it stands, and what happened so far. Before B11
// shipped, no meeting ever had a real `MatchRun` — this still reads
// whatever exists and returns `proposal: null` otherwise, the same
// forward-compatible shape `meeting-cards.ts` already uses for
// `currentDatetime`.

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
  /**
   * Whose calendar this proposal was not checked against — none connected
   * when it was made, so they were treated as free apart from the hours they
   * set. Read from the stored `calendar` facts, not from today's tokens: it
   * describes this proposal, and still holds after the person connects.
   */
  uncheckedCalendars: MissingHomeDTO[];
  /**
   * The other venues among ranks 2 and 3 — "we also considered X and Y"
   * (spec §4.1c). Each once, and never the proposed one: an option is a
   * venue *and* an hour, so ranks 2 and 3 are often the same place later.
   */
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
    }
  | {
      /**
       * B11: a context row with no `rejectionText` — "my situation
       * tonight is different" (spec §3.2), shown the moment it is made
       * rather than only inferred from a later run's `reweighedBecause`.
       */
      kind: "amendment";
      at: string;
      by: string;
      description: string;
    };

/** The other side of a clash — enough to say what approving here would undo. */
export type ConflictDTO = {
  meetingId: string;
  groupName: string;
  venueName: string | null;
  start: string | null;
  /** Already agreed by its group — approving here leaves it as it is. */
  confirmed: boolean;
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
  /**
   * Whether an amendment from the viewer right now would be their first for
   * this meeting (spec §3.1's one free correction). Mirrors `priorAmendments`
   * in `lib/db/meetings.ts` exactly — see its own comment for why both the
   * `rejectionText` and `softPreferences` clauses are load-bearing.
   */
  viewerAmendmentIsFree: boolean;
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
  /**
   * B9 part five: whole minutes until the next automatic attempt, when a
   * rate-limited call (`Meeting.retryNotBefore`, B9 parts two and four) is
   * the reason nothing is happening. Null when there is no such wait, and
   * for any meeting that is not `weighing`.
   */
  retryInMinutes: number | null;
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

/**
 * The venue names "גם שקלנו" lists: ranks 2 and 3, in rank order, without
 * the rank-1 venue and without repeats. A venue is the same by place id when
 * it has one, and by name when it does not.
 */
export function alsoConsideredOf(
  options: readonly {
    rank: number;
    venueName: string;
    venuePlaceId: string | null;
  }[]
): string[] {
  const key = (o: (typeof options)[number]) => o.venuePlaceId ?? o.venueName;
  const seen = new Set(options.filter((o) => o.rank === 1).map(key));
  const names: string[] = [];
  for (const option of [...options].sort((a, b) => a.rank - b.rank)) {
    if (seen.has(key(option))) continue;
    seen.add(key(option));
    names.push(option.venueName);
  }
  return names;
}

/**
 * The people a proposal's stored `calendar` facts name, in the order stored.
 * Someone no longer in the meeting's responses has no name to show and is
 * left out.
 */
export function uncheckedCalendarsOf(
  facts: readonly UnverifiedFact[],
  people: readonly MissingHomeDTO[]
): MissingHomeDTO[] {
  return facts.flatMap((fact) => {
    if (fact.kind !== "calendar") return [];
    const person = people.find((p) => p.userId === fact.userId);
    return person ? [person] : [];
  });
}

/**
 * Whole minutes (rounded up, at least 1) until `notBefore`, or null when
 * there is no wait left. Pure, so the rounding is tested without a clock.
 */
export function minutesUntil(notBefore: Date | null, now: Date): number | null {
  if (notBefore === null) return null;
  const ms = notBefore.getTime() - now.getTime();
  if (ms <= 0) return null;
  return Math.max(1, Math.ceil(ms / 60_000));
}

export async function getMeetingDetail(
  meetingId: string,
  viewerId: string,
  now: Date = new Date()
): Promise<MeetingDetailDTO | null> {
  const prisma = getPrisma();

  const row = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: {
      initiator: { select: { name: true } },
      responses: { include: { user: { select: { name: true } } } },
      // Every rejection and every amendment, each with its own words and
      // its own time. A `Response` row is *updated*, so its `reasonText`
      // and `respondedAt` only ever hold the last one — see the note on
      // `responses` in docs/database-schema.md. B11: no longer filtered to
      // rejections — an amendment now gets its own timeline entry too,
      // not only a mention inside a later run's `reweighedBecause`.
      participantContexts: {
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

  // Mirrors `priorAmendments` in `lib/db/meetings.ts` exactly, read-side:
  // both clauses matter, because every rejection now writes a context row
  // too (A7), and a NULL `softPreferences` alone would miscount one as an
  // amendment.
  const viewerAmendmentIsFree = !row.participantContexts.some(
    (c) =>
      c.userId === viewerId &&
      c.rejectionText === null &&
      c.softPreferences === null
  );

  // A confirmed meeting is a clash for the *other* meeting's page, where
  // there is still an approve button to warn above — not for its own.
  const conflictPairs =
    meeting.status === "closed" ? [] : await findConflictingMeetings(viewerId);
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
    confirmed: other.status === "closed",
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

  const unverified =
    (topOption?.unverified as UnverifiedFact[] | null | undefined) ?? [];
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
        unverified,
        uncheckedCalendars: uncheckedCalendarsOf(
          unverified,
          row.responses.map((r) => ({ userId: r.userId, name: r.user.name }))
        ),
        alsoConsidered: alsoConsideredOf(latestRun!.options),
      }
    : null;

  const missingHome =
    proposal === null || row.status === "stuck"
      ? await findMissingHome(
          meetingId,
          row.responses.map((r) => ({ userId: r.userId, name: r.user.name }))
        )
      : [];

  // B9 part five. Only means something while a run is actually being
  // retried, which is `weighing` -- a stuck, closed or awaiting meeting is
  // not waiting on either.
  const weighing = row.status === "weighing";
  const retryInMinutes = weighing
    ? minutesUntil(row.retryNotBefore, now)
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

  // Everything somebody said when rejecting or amending, one event each. A
  // person who objected (or amended) three times belongs in the timeline
  // three times, at the three moments they did it — those are the moments
  // that caused the re-weighings around them. B11: a row with no
  // `rejectionText` is an amendment, not a rejection — same table, same
  // `describeContext` `reweighedBecause` already uses, a different timeline
  // shape.
  const rejectionsByUser = new Map<string, number>();
  for (const context of row.participantContexts) {
    if (context.rejectionText !== null) {
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
    } else {
      timeline.push({
        kind: "amendment",
        at: context.createdAt.toISOString(),
        by: context.user.name,
        description: describeContext(context),
      });
    }
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
    viewerAmendmentIsFree,
    isStuck: row.status === "stuck",
    runStage: runStageOf(row),
    isInitiator: row.initiatorId === viewerId,
    conflicts,
    missingHome,
    retryInMinutes,
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

// Leaving a group, and deleting one (#250). The decision — who becomes admin, what the people
// who stay are told, whether open meetings go — is `planDeparture`'s
// (lib/groups/departure.ts); this carries it out.
//
// Two stages, and the order matters:
//
//  1. The leaver says "can't make it" in each open meeting, through
//     `respondToMeeting` itself, so everything that already follows a
//     withdrawal still does: a meeting everyone else approved is closed, and
//     the confirmation goes out. That has to happen while they are still a
//     member, and it is a transaction of its own per meeting.
//  2. One transaction, under a lock on the group's row, does the rest: the
//     membership goes, the leaver's old invitation goes (or they could never
//     be invited again — `invitations` is unique on group and email), they
//     are taken off the open meetings, the admin role is passed on, meetings
//     are cancelled if the group fell below three, and the notices are
//     written. The lock is what makes two people leaving at once safe: the
//     second one sees the first one's result, so the last member really is
//     the last.
//
// A leaver is taken off open meetings by deleting their `Response`. That is
// also what ends their access: a meeting is open to whoever has a Response
// for it, so nothing else needs to check membership. Meetings already closed
// or cancelled are history, and stay as they were.
//
// #256: the admin removing a member is the same departure, asked for by
// someone else — `removedBy`. Checked to be the admin at both stages, and the
// notices say "removed", to the one removed too.

import { getPrisma } from "./client";
import { MeetingNotOpenError, respondToMeeting } from "./meetings";
import { MeetingStatus, ResponseStatus } from "@/lib/generated/prisma/client";
import { NotificationKind } from "@/lib/generated/prisma/enums";
import { NotInGroupError, planDeparture } from "@/lib/groups/departure";

export { LastMemberError, NotInGroupError } from "@/lib/groups/departure";

/** Only the group's admin can delete it, or remove a member (#256). */
export class NotTheAdminError extends Error {
  constructor(groupId: string) {
    super(`Only the admin of group ${groupId} can do that.`);
    this.name = "NotTheAdminError";
  }
}

/** The meetings that can still change; `closed` and `cancelled` cannot. */
const OPEN_MEETING_STATUSES = [
  MeetingStatus.weighing,
  MeetingStatus.awaiting,
  MeetingStatus.stuck,
];

export type LeaveGroupResult = {
  /**
   * Meetings that became confirmed because the leaver was the only one still
   * to answer. The caller sends the confirmation, outside the request, like
   * the respond route does.
   */
  closedMeetingIds: string[];
};

/** #256: a removal must be asked for by a member who is the admin. */
function checkRemover(
  members: readonly { userId: string; isAdmin: boolean }[],
  removedBy: string | undefined,
  groupId: string
) {
  if (removedBy === undefined) return;
  const remover = members.find((member) => member.userId === removedBy);
  if (!remover) throw new NotInGroupError(removedBy);
  if (!remover.isAdmin) throw new NotTheAdminError(groupId);
}

/**
 * `random` is a parameter only so a test can say who becomes admin.
 * `removedBy` is the admin removing `userId` (#256); without it, they left.
 */
export async function leaveGroup(
  userId: string,
  groupId: string,
  {
    random = Math.random,
    removedBy,
  }: { random?: () => number; removedBy?: string } = {}
): Promise<LeaveGroupResult> {
  const prisma = getPrisma();

  // A first look, only so a person who cannot leave — a stranger, or the last
  // member — is turned away before anything is changed. The decision is made
  // again, for good, inside the transaction below.
  const before = await prisma.groupMember.findMany({
    where: { groupId },
    select: { userId: true, isAdmin: true },
  });
  planDeparture({
    memberIds: before.map((member) => member.userId),
    adminId: before.find((member) => member.isAdmin)?.userId ?? null,
    leaverId: userId,
  });
  checkRemover(before, removedBy, groupId);

  const openMeetings = await prisma.meeting.findMany({
    where: {
      groupId,
      status: { in: OPEN_MEETING_STATUSES },
      responses: {
        some: { userId, status: { not: ResponseStatus.cant_make_it } },
      },
    },
    select: { id: true },
  });
  const closedMeetingIds: string[] = [];
  for (const { id } of openMeetings) {
    try {
      const result = await respondToMeeting(id, userId, {
        kind: "cant_make_it",
      });
      if (result.justClosed) closedMeetingIds.push(id);
    } catch (error) {
      // Closed or cancelled since the list was read: nothing left to say.
      if (!(error instanceof MeetingNotOpenError)) throw error;
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "groups" WHERE "id" = ${groupId} FOR UPDATE`;

    const members = await tx.groupMember.findMany({
      where: { groupId },
      orderBy: { joinedAt: "asc" },
      select: {
        userId: true,
        isAdmin: true,
        user: { select: { name: true, email: true } },
      },
    });
    const plan = planDeparture({
      memberIds: members.map((member) => member.userId),
      adminId: members.find((member) => member.isAdmin)?.userId ?? null,
      leaverId: userId,
      random,
    });
    checkRemover(members, removedBy, groupId);
    const leaver = members.find((member) => member.userId === userId)!;

    await tx.groupMember.delete({
      where: { groupId_userId: { groupId, userId } },
    });
    await tx.invitation.deleteMany({
      where: {
        groupId,
        status: "accepted",
        OR: [
          { acceptedByUserId: userId },
          { email: { equals: leaver.user.email, mode: "insensitive" } },
        ],
      },
    });
    await tx.response.deleteMany({
      where: {
        userId,
        meeting: { groupId, status: { in: OPEN_MEETING_STATUSES } },
      },
    });

    let meetingsCancelled = 0;
    if (plan.cancelOpenMeetings) {
      const cancelled = await tx.meeting.updateMany({
        where: { groupId, status: { in: OPEN_MEETING_STATUSES } },
        data: { status: MeetingStatus.cancelled },
      });
      meetingsCancelled = cancelled.count;
    }

    if (plan.newAdminId) {
      await tx.groupMember.update({
        where: { groupId_userId: { groupId, userId: plan.newAdminId } },
        data: { isAdmin: true },
      });
    }

    const group = await tx.group.findUniqueOrThrow({
      where: { id: groupId },
      select: { name: true },
    });
    await tx.notification.createMany({
      data: [
        ...plan.remaining.map((remainingId) => ({
          userId: remainingId,
          kind:
            removedBy && plan.notice === "member_left"
              ? NotificationKind.member_removed
              : NotificationKind[plan.notice],
          groupId,
          groupName: group.name,
          actorName: leaver.user.name,
          ...(plan.notice === "group_inactive" && { meetingsCancelled }),
        })),
        ...(removedBy
          ? [
              {
                userId,
                kind: NotificationKind.removed_from_group,
                groupId,
                groupName: group.name,
              },
            ]
          : []),
        ...(plan.newAdminId
          ? [
              {
                userId: plan.newAdminId,
                kind: NotificationKind.became_admin,
                groupId,
                groupName: group.name,
              },
            ]
          : []),
      ],
    });
  });

  return { closedMeetingIds };
}

/**
 * The admin deletes the group, and with it everything in it: the members,
 * the invitations and every meeting, confirmed ones included (the database
 * cascades from the group). Everybody else is told, in-app, with how many
 * meetings were still planned. Those notices have no foreign key to the
 * group, which is what lets them outlive it.
 *
 * Under the same lock as leaving, so a member leaving at the same moment
 * either finishes first or finds the group gone.
 */
export async function deleteGroup(
  userId: string,
  groupId: string
): Promise<void> {
  const prisma = getPrisma();

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "groups" WHERE "id" = ${groupId} FOR UPDATE`;

    const members = await tx.groupMember.findMany({
      where: { groupId },
      select: { userId: true, isAdmin: true, user: { select: { name: true } } },
    });
    const caller = members.find((member) => member.userId === userId);
    if (!caller) throw new NotInGroupError(userId);
    if (!caller.isAdmin) throw new NotTheAdminError(groupId);

    const group = await tx.group.findUniqueOrThrow({
      where: { id: groupId },
      select: { name: true },
    });
    // Every meeting that was still going to happen or being arranged; the
    // ones already cancelled were gone to begin with.
    const meetingsCancelled = await tx.meeting.count({
      where: { groupId, status: { not: MeetingStatus.cancelled } },
    });

    const others = members.filter((member) => member.userId !== userId);
    if (others.length > 0) {
      await tx.notification.createMany({
        data: others.map((other) => ({
          userId: other.userId,
          kind: NotificationKind.group_deleted,
          groupId,
          groupName: group.name,
          actorName: caller.user.name,
          meetingsCancelled,
        })),
      });
    }

    await tx.group.delete({ where: { id: groupId } });
  });
}

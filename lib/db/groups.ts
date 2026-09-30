// Group size domain logic (spec §5.3: "Groups of 3–6") — #174. Parallel to
// lib/db/meetings.ts: both enforcement points (inviting past the upper
// bound, opening a meeting under the lower one) call into here rather than
// each counting rows its own way, so the two can never drift apart.

import { Prisma } from "@/lib/generated/prisma/client";

export const GROUP_SIZE_CAP = 6;
export const GROUP_SIZE_FLOOR = 3;

/**
 * Counting only accepted members would let a group send far more
 * invitations than it has room for, and have them all land at once — the
 * upper bound is against members *plus* still-pending invitations.
 */
export class GroupFullError extends Error {
  constructor(groupId: string) {
    super(
      `Group ${groupId} already has ${GROUP_SIZE_CAP} members or pending invitations.`
    );
    this.name = "GroupFullError";
  }
}

/** The lower bound: a meeting needs at least this many members to open. */
export class GroupTooSmallError extends Error {
  constructor(groupId: string, memberCount: number) {
    super(
      `Group ${groupId} has ${memberCount} members; a meeting needs at least ${GROUP_SIZE_FLOOR}.`
    );
    this.name = "GroupTooSmallError";
  }
}

export async function groupSizeWithPending(
  tx: Prisma.TransactionClient,
  groupId: string
): Promise<number> {
  const [members, pending] = await Promise.all([
    tx.groupMember.count({ where: { groupId } }),
    tx.invitation.count({ where: { groupId, status: "pending" } }),
  ]);
  return members + pending;
}

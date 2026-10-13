// What happens to a group when one of its members leaves (#250) — decided
// here, as plain data in and out, so every case can be tested without a
// database. `leaveGroup` (lib/db/group-membership.ts) carries the decision
// out inside one transaction.

import { GROUP_SIZE_FLOOR } from "@/lib/groups/size";

export type DeparturePlan = {
  /** Who is left, in the order they were given. Never empty. */
  remaining: string[];
  /**
   * The member who becomes admin, when the leaver was the admin (or the
   * group somehow had none). `null` when the admin stays.
   */
  newAdminId: string | null;
  /**
   * What the people who stay are told. Below the floor a group cannot open a
   * meeting any more, which is a bigger thing than somebody leaving.
   */
  notice: "member_left" | "group_inactive";
  /** The meetings still open can no longer happen, so they are cancelled. */
  cancelOpenMeetings: boolean;
};

export class NotInGroupError extends Error {
  constructor(userId: string) {
    super(`${userId} is not a member of this group.`);
    this.name = "NotInGroupError";
  }
}

/** The last member cannot leave: that would leave a group nobody is in. */
export class LastMemberError extends Error {
  constructor() {
    super("The last member cannot leave a group; they can delete it.");
    this.name = "LastMemberError";
  }
}

/**
 * `random` returns a number in [0, 1), like `Math.random`. It is a parameter
 * only so a test can say which of the remaining members it picks.
 */
export function planDeparture(input: {
  memberIds: readonly string[];
  adminId: string | null;
  leaverId: string;
  random?: () => number;
}): DeparturePlan {
  const { memberIds, adminId, leaverId, random = Math.random } = input;

  if (!memberIds.includes(leaverId)) throw new NotInGroupError(leaverId);
  const remaining = memberIds.filter((id) => id !== leaverId);
  if (remaining.length === 0) throw new LastMemberError();

  const adminLeaves = adminId === null || adminId === leaverId;
  const newAdminId = adminLeaves
    ? remaining[
        Math.min(Math.floor(random() * remaining.length), remaining.length - 1)
      ]
    : null;

  const belowFloor = remaining.length < GROUP_SIZE_FLOOR;
  return {
    remaining,
    newAdminId,
    notice: belowFloor ? "group_inactive" : "member_left",
    cancelOpenMeetings: belowFloor,
  };
}

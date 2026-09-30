import { describe, expect, it, vi } from "vitest";

import { groupSizeWithPending } from "./groups";
import type { Prisma } from "@/lib/generated/prisma/client";

function fakeTx(members: number, pending: number) {
  return {
    groupMember: { count: vi.fn().mockResolvedValue(members) },
    invitation: { count: vi.fn().mockResolvedValue(pending) },
  } as unknown as Prisma.TransactionClient;
}

describe("groupSizeWithPending (#174)", () => {
  it("adds accepted members and pending invitations together", async () => {
    const tx = fakeTx(4, 2);

    expect(await groupSizeWithPending(tx, "g1")).toBe(6);
  });

  it("counts pending invitations only, not accepted ones", async () => {
    const tx = fakeTx(3, 0);

    await groupSizeWithPending(tx, "g1");

    expect(tx.invitation.count).toHaveBeenCalledWith({
      where: { groupId: "g1", status: "pending" },
    });
  });

  it("is just the member count when nothing is pending", async () => {
    const tx = fakeTx(5, 0);

    expect(await groupSizeWithPending(tx, "g1")).toBe(5);
  });
});

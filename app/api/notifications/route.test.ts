import { beforeEach, expect, it, vi } from "vitest";

const { authMock, findMany, updateMany } = vi.hoisted(() => ({
  authMock: vi.fn(),
  findMany: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db/client", () => ({
  getPrisma: () => ({
    notification: { findMany, updateMany },
    groupMember: { findMany: vi.fn() },
  }),
}));

import { GET } from "./route";

beforeEach(() => vi.clearAllMocks());

it("#238: lists this user's notifications and marks none of them read", async () => {
  authMock.mockResolvedValue({ user: { id: "user-1" } });
  findMany.mockResolvedValue([
    {
      id: "n1",
      kind: "proposal_waiting",
      meetingId: "m1",
      groupId: null,
      createdAt: new Date("2026-10-01T10:00:00.000Z"),
      readAt: null,
    },
  ]);

  const res = await GET();

  expect((await res.json()).map((n: { id: string }) => n.id)).toEqual(["n1"]);
  expect(updateMany).not.toHaveBeenCalled();
});

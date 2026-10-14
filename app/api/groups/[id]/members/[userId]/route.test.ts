import { beforeEach, expect, it, vi } from "vitest";

const { authMock, leaveGroup, notifyMeetingConfirmed } = vi.hoisted(() => ({
  authMock: vi.fn(),
  leaveGroup: vi.fn(),
  notifyMeetingConfirmed: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/server", () => ({
  after: (work: () => unknown) => work(),
}));
vi.mock("@/lib/email/notify", () => ({ notifyMeetingConfirmed }));
vi.mock("@/lib/db/group-membership", async (original) => ({
  ...(await original<object>()),
  leaveGroup,
}));

const { NotInGroupError } = await import("@/lib/groups/departure");
const { NotTheAdminError } = await import("@/lib/db/group-membership");
const { DELETE } = await import("./route");

function call(userId: string) {
  return DELETE(new Request("http://test"), {
    params: Promise.resolve({ id: "g1", userId }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  authMock.mockResolvedValue({ user: { id: "admin" } });
});

it("#256: removes the member as the admin, and confirms the meetings it closed", async () => {
  leaveGroup.mockResolvedValue({ closedMeetingIds: ["m1"] });

  const res = await call("b");

  expect(res.status).toBe(204);
  expect(leaveGroup).toHaveBeenCalledWith("b", "g1", { removedBy: "admin" });
  expect(notifyMeetingConfirmed).toHaveBeenCalledWith("m1");
});

it("sends the admin to leaving, rather than removing themselves", async () => {
  const res = await call("admin");

  expect(res.status).toBe(400);
  expect(leaveGroup).not.toHaveBeenCalled();
});

it("answers 404 for a group or member that is not there, 403 for a non-admin", async () => {
  leaveGroup.mockRejectedValueOnce(new NotInGroupError("b"));
  expect((await call("b")).status).toBe(404);

  leaveGroup.mockRejectedValueOnce(new NotTheAdminError("g1"));
  const res = await call("b");
  expect(res.status).toBe(403);
  expect((await res.json()).error).toBe("Only the admin can remove a member.");
});

it("answers 401 to nobody signed in", async () => {
  authMock.mockResolvedValue(null);

  expect((await call("b")).status).toBe(401);
  expect(leaveGroup).not.toHaveBeenCalled();
});

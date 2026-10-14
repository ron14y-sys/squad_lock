import { beforeEach, expect, it, vi } from "vitest";

const { authMock, updateMany, revalidatePath } = vi.hoisted(() => ({
  authMock: vi.fn(),
  updateMany: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db/client", () => ({
  getPrisma: () => ({ notification: { updateMany } }),
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import { openNotification } from "./actions";

beforeEach(() => vi.clearAllMocks());

it("#238: marks the one opened read for the signed-in user, and redraws the header", async () => {
  authMock.mockResolvedValue({ user: { id: "user-1" } });

  await openNotification("n1");

  expect(updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: "n1", userId: "user-1", readAt: null },
    })
  );
  expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
});

it("does nothing when nobody is signed in", async () => {
  authMock.mockResolvedValue(null);

  await openNotification("n1");

  expect(updateMany).not.toHaveBeenCalled();
  expect(revalidatePath).not.toHaveBeenCalled();
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirectMock, authMock, findUnique } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  authMock: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db/client", () => ({
  getPrisma: () => ({ preferenceProfile: { findUnique } }),
}));

vi.mock("@/app/_components/MissingHomeBanner", () => ({
  MissingHomeBanner: () => null,
}));
vi.mock("./GroupsList", () => ({ GroupsList: () => null }));

import GroupsPage from "./page";

beforeEach(() => {
  redirectMock.mockClear();
  findUnique.mockReset();
});

describe("GroupsPage (#173)", () => {
  it("sends a first-time user — no PreferenceProfile row at all — to the game", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    findUnique.mockResolvedValue(null);

    await expect(GroupsPage()).rejects.toThrow(
      "REDIRECT:/onboarding/preferences"
    );
  });

  it("sends someone who played the game but has no home to set it", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    findUnique.mockResolvedValue({ homeLat: null, homeLng: null });

    await expect(GroupsPage()).rejects.toThrow("REDIRECT:/profile/location");
  });

  it("renders the groups list once both are done", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    findUnique.mockResolvedValue({ homeLat: 32.08, homeLng: 34.78 });

    await GroupsPage();

    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("does not look up a profile at all when signed out", async () => {
    authMock.mockResolvedValue(null);

    await GroupsPage();

    expect(findUnique).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});

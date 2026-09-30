import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirectMock, authMock, signInMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  authMock: vi.fn(),
  signInMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/auth", () => ({ auth: authMock, signIn: signInMock }));

import Home from "./page";

beforeEach(() => {
  redirectMock.mockClear();
  authMock.mockReset();
  signInMock.mockReset();
});

describe("Home (#171)", () => {
  it("sends a signed-in visitor straight to /groups", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });

    await expect(Home({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "REDIRECT:/groups"
    );
  });

  it("renders the landing page for a signed-out visitor", async () => {
    authMock.mockResolvedValue(null);

    const result = await Home({ searchParams: Promise.resolve({}) });

    expect(result).toBeTruthy();
  });

  it("signs in with Google, redirecting to /groups when no callback URL was given", async () => {
    authMock.mockResolvedValue(null);

    const element = await Home({ searchParams: Promise.resolve({}) });
    await element.props.onGoogleSignIn();

    expect(signInMock).toHaveBeenCalledWith("google", {
      redirectTo: "/groups",
    });
  });

  it("preserves a callback URL through to Google sign-in", async () => {
    authMock.mockResolvedValue(null);

    const element = await Home({
      searchParams: Promise.resolve({ callbackUrl: "/groups/g1" }),
    });
    await element.props.onGoogleSignIn();

    expect(signInMock).toHaveBeenCalledWith("google", {
      redirectTo: "/groups/g1",
    });
  });
});

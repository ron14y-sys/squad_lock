import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MissingHomeBanner } from "./MissingHomeBanner";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("tells a user with no home point where to set one", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse({ home: null }));
  render(<MissingHomeBanner />);

  const link = await screen.findByRole("link", { name: "הגדר עכשיו" });
  expect(link).toHaveAttribute("href", "/profile/location");
});

test("says nothing to a user who already has one", async () => {
  fetchMock.mockResolvedValueOnce(
    jsonResponse({ home: { lat: 32.0158, lng: 34.7874 } })
  );
  render(<MissingHomeBanner />);

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  await Promise.resolve();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("says nothing when signed out or when the request fails", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse({ error: "no" }, 401));
  const { unmount } = render(<MissingHomeBanner />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  unmount();

  fetchMock.mockRejectedValueOnce(new Error("offline"));
  render(<MissingHomeBanner />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

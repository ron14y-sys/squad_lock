import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NotificationsList } from "./NotificationsList";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function card(overrides: Record<string, unknown> = {}) {
  return {
    id: "n1",
    kind: "proposal_waiting",
    meetingId: "meeting-1",
    createdAt: "2026-10-01T10:00:00.000Z",
    isNew: true,
    ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("shows each notification's label and links meeting-scoped ones to the meeting", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse([card()]));

  render(<NotificationsList />);

  const link = await screen.findByRole("link");
  expect(link).toHaveAttribute("href", "/meetings/meeting-1");
  expect(
    screen.getByText("הוצעה פגישה — ממתינה לתשובה שלך")
  ).toBeInTheDocument();
});

test("links calendar_reconnect to the re-auth route, not a meeting", async () => {
  fetchMock.mockResolvedValueOnce(
    jsonResponse([
      card({ kind: "calendar_reconnect", meetingId: null, id: "n2" }),
    ])
  );

  render(<NotificationsList />);

  const link = await screen.findByRole("link");
  expect(link.getAttribute("href")).toBe(
    "/api/auth/signin?callbackUrl=%2Fgroups"
  );
});

test("shows an empty state when there are none", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse([]));

  render(<NotificationsList />);

  expect(await screen.findByText("אין לך התראות עדיין.")).toBeInTheDocument();
});

test("shows a sign-in prompt on 401", async () => {
  fetchMock.mockResolvedValueOnce(
    jsonResponse({ error: "Not signed in." }, 401)
  );

  render(<NotificationsList />);

  expect(
    await screen.findByText("התחבר כדי לראות את ההתראות שלך.")
  ).toBeInTheDocument();
});

test("shows a retry message when the fetch fails", async () => {
  fetchMock.mockRejectedValueOnce(new Error("network down"));

  render(<NotificationsList />);

  expect(
    await screen.findByText("לא הצלחנו לטעון את ההתראות.")
  ).toBeInTheDocument();
});

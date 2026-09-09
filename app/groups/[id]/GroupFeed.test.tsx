import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GroupFeed } from "./GroupFeed";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function card(overrides: Record<string, unknown> = {}) {
  return {
    id: "meeting-1",
    status: "waiting_on_you",
    waitingOn: null,
    currentDatetime: "2026-09-15T18:00:00.000Z",
    pinnedWhen: null,
    pinnedVenue: null,
    occasion: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    approvedCount: 0,
    totalCount: 2,
    isPast: false,
    participants: [
      { userId: "u1", name: "Dana", status: "pending" },
      { userId: "u2", name: "Yoav", status: "approved" },
    ],
    ...overrides,
  };
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

beforeEach(() => {
  setVisibility("visible");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("shows a card awaiting the viewer, highlighted, with its summary and avatars", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(jsonResponse({ meetings: [card()], openCount: 1 }))
    )
  );

  render(<GroupFeed groupId="group-1" />);

  expect(await screen.findByText("ממתין לך")).toBeInTheDocument();
  expect(screen.getByText(/0 מתוך 2 אישרו/)).toBeInTheDocument();
  expect(screen.getByTitle("Dana — טרם הגיב")).toBeInTheDocument();
  expect(screen.getByTitle("Yoav — אישר")).toBeInTheDocument();
});

test("shows waiting_on_others with the number still pending", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          meetings: [card({ status: "waiting_on_others", waitingOn: 2 })],
          openCount: 1,
        })
      )
    )
  );

  render(<GroupFeed groupId="group-1" />);

  expect(await screen.findByText("ממתין לעוד 2")).toBeInTheDocument();
});

test("disables the initiate button and explains why at the 3-meeting cap", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          meetings: [
            card({ id: "m1" }),
            card({ id: "m2" }),
            card({ id: "m3" }),
          ],
          openCount: 3,
        })
      )
    )
  );

  render(<GroupFeed groupId="group-1" />);

  const button = await screen.findByRole("button", { name: "פתח פגישה חדשה" });
  expect(button).toBeDisabled();
  expect(screen.getByText(/אי אפשר לפתוח פגישה נוספת/)).toBeInTheDocument();
});

test("leaves the initiate button enabled under the cap", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(jsonResponse({ meetings: [card()], openCount: 1 }))
    )
  );

  render(<GroupFeed groupId="group-1" />);

  const button = await screen.findByRole("button", { name: "פתח פגישה חדשה" });
  expect(button).not.toBeDisabled();
});

test("renders a divider before past meetings", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          meetings: [
            card({ id: "upcoming", isPast: false }),
            card({ id: "past", isPast: true, status: "closed" }),
          ],
          openCount: 1,
        })
      )
    )
  );

  render(<GroupFeed groupId="group-1" />);

  await screen.findByText("ממתין לך");
  expect(screen.getByText("פגישות שעברו")).toBeInTheDocument();
});

test("shows a sign-in prompt when unauthenticated", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(jsonResponse({ error: "Not signed in." }, 401)))
  );

  render(<GroupFeed groupId="group-1" />);

  expect(
    await screen.findByText("התחבר כדי לראות פגישות.")
  ).toBeInTheDocument();
});

test("polls every ~3s while a meeting on screen is re-weighing", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const fetchMock = vi.fn(() =>
    Promise.resolve(
      jsonResponse({
        meetings: [card({ status: "reweighing" })],
        openCount: 1,
      })
    )
  );
  vi.stubGlobal("fetch", fetchMock);

  render(<GroupFeed groupId="group-1" />);
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

  await vi.advanceTimersByTimeAsync(3000);
  expect(fetchMock).toHaveBeenCalledTimes(2);

  await vi.advanceTimersByTimeAsync(3000);
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

test("polls every ~30s once nothing is re-weighing", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const fetchMock = vi.fn(() =>
    Promise.resolve(jsonResponse({ meetings: [card()], openCount: 1 }))
  );
  vi.stubGlobal("fetch", fetchMock);

  render(<GroupFeed groupId="group-1" />);
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

  await vi.advanceTimersByTimeAsync(3000);
  expect(fetchMock).toHaveBeenCalledTimes(1);

  await vi.advanceTimersByTimeAsync(27000);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("stops polling entirely while the tab is backgrounded", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const fetchMock = vi.fn(() =>
    Promise.resolve(
      jsonResponse({
        meetings: [card({ status: "reweighing" })],
        openCount: 1,
      })
    )
  );
  vi.stubGlobal("fetch", fetchMock);

  render(<GroupFeed groupId="group-1" />);
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

  setVisibility("hidden");
  document.dispatchEvent(new Event("visibilitychange"));

  await vi.advanceTimersByTimeAsync(60000);
  // Only the initial fetch — nothing scheduled while hidden.
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("refreshes immediately when the tab returns to the foreground", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const fetchMock = vi.fn(() =>
    Promise.resolve(jsonResponse({ meetings: [card()], openCount: 1 }))
  );
  vi.stubGlobal("fetch", fetchMock);

  setVisibility("hidden");
  render(<GroupFeed groupId="group-1" />);
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

  setVisibility("visible");
  document.dispatchEvent(new Event("visibilitychange"));

  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
});

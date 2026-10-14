import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NotificationsList } from "./NotificationsList";
import { openNotification } from "./actions";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/notifications",
}));
vi.mock("./actions", () => ({ openNotification: vi.fn() }));

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
  vi.clearAllMocks();
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
    "/api/calendar/connect?callbackUrl=%2Fgroups"
  );
});

test("a group notice links to its group while the person is still in it", async () => {
  fetchMock.mockResolvedValueOnce(
    jsonResponse([
      card({
        kind: "group_inactive",
        meetingId: null,
        group: {
          id: "group-1",
          name: "השישיה",
          actorName: "דנה",
          meetingsCancelled: 1,
          linkable: true,
        },
      }),
    ])
  );

  render(<NotificationsList />);

  const link = await screen.findByRole("link");
  expect(link).toHaveAttribute("href", "/groups/group-1");
  expect(screen.getByText(/דנה יצא\/ה מהקבוצה "השישיה"/)).toBeInTheDocument();
});

test("a notice about a deleted group has nowhere to go", async () => {
  fetchMock.mockResolvedValueOnce(
    jsonResponse([
      card({
        kind: "group_deleted",
        meetingId: null,
        group: {
          id: "group-1",
          name: "השישיה",
          actorName: null,
          meetingsCancelled: 0,
          linkable: false,
        },
      }),
    ])
  );

  render(<NotificationsList />);

  expect(
    await screen.findByText('המנהל/ת מחק/ה את הקבוצה "השישיה".')
  ).toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
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

test("#238: opening one marks it read first, then goes where it leads", async () => {
  let marked = () => {};
  vi.mocked(openNotification).mockReturnValue(
    new Promise<void>((resolve) => (marked = resolve))
  );
  fetchMock.mockResolvedValueOnce(
    jsonResponse([card(), card({ id: "n2", meetingId: "meeting-2" })])
  );

  render(<NotificationsList />);
  const [first] = await screen.findAllByRole("link");
  expect(openNotification).not.toHaveBeenCalled();

  fireEvent.click(first);
  expect(openNotification).toHaveBeenCalledTimes(1);
  expect(openNotification).toHaveBeenCalledWith("n1");
  expect(push).not.toHaveBeenCalled();

  marked();
  await waitFor(() => expect(push).toHaveBeenCalledWith("/meetings/meeting-1"));
});

test("#238: one already read is not marked again, and still goes", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse([card({ isNew: false })]));

  render(<NotificationsList />);
  fireEvent.click(await screen.findByRole("link"));

  await waitFor(() => expect(push).toHaveBeenCalledWith("/meetings/meeting-1"));
  expect(openNotification).not.toHaveBeenCalled();
});

test("#238: if marking fails, it still goes", async () => {
  vi.mocked(openNotification).mockRejectedValueOnce(new Error("offline"));
  fetchMock.mockResolvedValueOnce(jsonResponse([card()]));

  render(<NotificationsList />);
  fireEvent.click(await screen.findByRole("link"));

  await waitFor(() => expect(push).toHaveBeenCalledWith("/meetings/meeting-1"));
});

test("#238: one with nowhere to go is read in place, and fades", async () => {
  fetchMock.mockResolvedValueOnce(
    jsonResponse([
      card({
        kind: "group_deleted",
        meetingId: null,
        group: {
          id: "group-1",
          name: "השישיה",
          actorName: null,
          meetingsCancelled: 0,
          linkable: false,
        },
      }),
    ])
  );

  render(<NotificationsList />);
  const button = await screen.findByRole("button");
  expect(button.firstElementChild).not.toHaveClass("opacity-60");

  fireEvent.click(button);

  await waitFor(() =>
    expect(button.firstElementChild).toHaveClass("opacity-60")
  );
  expect(openNotification).toHaveBeenCalledWith("n1");
  expect(push).not.toHaveBeenCalled();
});

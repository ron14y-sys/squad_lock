import { afterEach, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewMeeting } from "./NewMeeting";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/groups/group-1/new",
}));

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  pushMock.mockClear();
});

test("pressing the button with nothing filled in opens an all-blank meeting", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(() =>
    Promise.resolve(jsonResponse({ id: "meeting-1" }, 201))
  );
  vi.stubGlobal("fetch", fetchMock);

  render(<NewMeeting groupId="group-1" />);
  await user.click(screen.getByRole("button", { name: "פתח פגישה" }));

  const [url, init] = fetchMock.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  expect(url).toBe("/api/groups/group-1/meetings");
  expect(init.method).toBe("POST");
  expect(JSON.parse(init.body as string)).toEqual({});
  expect(pushMock).toHaveBeenCalledWith("/meetings/meeting-1");
});

test("sends only the fields that were filled in", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({}, 201)));
  vi.stubGlobal("fetch", fetchMock);

  render(<NewMeeting groupId="group-1" />);

  await user.type(screen.getByLabelText("מקום"), "בית קפה נורדאו");
  await user.type(
    screen.getByLabelText("לרגל מה נפגשים (אופציונלי)"),
    "יום הולדת"
  );
  await user.click(screen.getByRole("button", { name: "פתח פגישה" }));

  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(init.body as string)).toEqual({
    venue: "בית קפה נורדאו",
    occasion: "יום הולדת",
  });
});

test("sends a chosen part of day, with no date at all (#168)", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({}, 201)));
  vi.stubGlobal("fetch", fetchMock);

  render(<NewMeeting groupId="group-1" />);
  await user.click(screen.getByRole("button", { name: "ערב" }));
  await user.click(screen.getByRole("button", { name: "פתח פגישה" }));

  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(init.body as string)).toEqual({ part: "evening" });
});

test("sends both a date and a part of day together", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({}, 201)));
  vi.stubGlobal("fetch", fetchMock);

  render(<NewMeeting groupId="group-1" />);
  await user.type(screen.getByLabelText("תאריך"), "2026-09-20");
  await user.click(screen.getByRole("button", { name: "בוקר" }));
  await user.click(screen.getByRole("button", { name: "פתח פגישה" }));

  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(init.body as string)).toEqual({
    date: "2026-09-20",
    part: "morning",
  });
});

test("clicking a chosen part again deselects it", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({}, 201)));
  vi.stubGlobal("fetch", fetchMock);

  render(<NewMeeting groupId="group-1" />);
  const midday = screen.getByRole("button", { name: "צהריים" });
  await user.click(midday);
  expect(midday).toHaveAttribute("aria-pressed", "true");

  await user.click(midday);
  expect(midday).toHaveAttribute("aria-pressed", "false");

  await user.click(screen.getByRole("button", { name: "פתח פגישה" }));
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(init.body as string)).toEqual({});
});

test("choosing a different part replaces the previous one", async () => {
  const user = userEvent.setup();
  render(<NewMeeting groupId="group-1" />);

  const morning = screen.getByRole("button", { name: "בוקר" });
  const evening = screen.getByRole("button", { name: "ערב" });
  await user.click(morning);
  await user.click(evening);

  expect(morning).toHaveAttribute("aria-pressed", "false");
  expect(evening).toHaveAttribute("aria-pressed", "true");
});

test("shows a friendly message and no redirect when the group is at its cap", async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        jsonResponse(
          { error: "Group group-1 already has 3 open meetings." },
          409
        )
      )
    )
  );

  render(<NewMeeting groupId="group-1" />);
  await user.click(screen.getByRole("button", { name: "פתח פגישה" }));

  expect(
    await screen.findByText(
      "כבר יש 3 פגישות פתוחות בקבוצה. סגרו אחת כדי לפתוח חדשה."
    )
  ).toBeInTheDocument();
  expect(pushMock).not.toHaveBeenCalled();
});

test("shows a friendly message and no redirect when the group is too small (#174)", async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        jsonResponse(
          { error: "Group group-1 has 2 members; a meeting needs at least 3." },
          409
        )
      )
    )
  );

  render(<NewMeeting groupId="group-1" />);
  await user.click(screen.getByRole("button", { name: "פתח פגישה" }));

  expect(
    await screen.findByText("אי אפשר לפתוח פגישה בקבוצה עם פחות מ-3 חברים.")
  ).toBeInTheDocument();
  expect(pushMock).not.toHaveBeenCalled();
});

test("shows a sign-in prompt when unauthenticated", async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(jsonResponse({ error: "Not signed in." }, 401)))
  );

  render(<NewMeeting groupId="group-1" />);
  await user.click(screen.getByRole("button", { name: "פתח פגישה" }));

  expect(await screen.findByText("התחבר כדי לפתוח פגישה.")).toBeInTheDocument();
});

test("shows a not-found message for a group the user isn't in", async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(jsonResponse({ error: "Group not found." }, 404))
    )
  );

  render(<NewMeeting groupId="group-1" />);
  await user.click(screen.getByRole("button", { name: "פתח פגישה" }));

  expect(
    await screen.findByText("הקבוצה הזו לא נמצאה, או שאתה לא חבר בה.")
  ).toBeInTheDocument();
});

// #240: the server checks a typed venue and counts the misses.
test("says a typed place is not a restaurant, keeps the field to correct it, and says how many tries are left", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(() =>
    Promise.resolve(
      jsonResponse(
        { error: "venue_not_a_venue", venue: "סטודיו יוגה", attemptsLeft: 2 },
        422
      )
    )
  );
  vi.stubGlobal("fetch", fetchMock);

  render(<NewMeeting groupId="group-1" />);
  await user.type(screen.getByLabelText("מקום"), "סטודיו יוגה");
  await user.click(screen.getByRole("button", { name: "פתח פגישה" }));

  expect(
    await screen.findByText(
      "״סטודיו יוגה״ הוא לא מסעדה, בר או בית קפה. יכול להיות שהתבלבלת? אפשר לתקן עוד 2 פעמים."
    )
  ).toBeInTheDocument();
  expect(screen.getByLabelText("מקום")).toBeEnabled();
  expect(screen.getByLabelText("מקום")).toHaveValue("סטודיו יוגה");
  expect(pushMock).not.toHaveBeenCalled();
});

test("says a typed place was not found, with one try left", async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        jsonResponse(
          { error: "venue_not_found", venue: "ברר הים", attemptsLeft: 1 },
          422
        )
      )
    )
  );

  render(<NewMeeting groupId="group-1" />);
  await user.type(screen.getByLabelText("מקום"), "ברר הים");
  await user.click(screen.getByRole("button", { name: "פתח פגישה" }));

  expect(
    await screen.findByText(
      "לא מצאנו מקום בשם ״ברר הים״. אולי יש טעות בשם? אפשר לתקן עוד פעם אחת."
    )
  ).toBeInTheDocument();
});

test("locks the field on the last miss, and opens the meeting without a place", async () => {
  const user = userEvent.setup();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      jsonResponse(
        { error: "venue_not_found", venue: "ברר", attemptsLeft: 0 },
        422
      )
    )
    .mockResolvedValueOnce(jsonResponse({ id: "meeting-1" }, 201));
  vi.stubGlobal("fetch", fetchMock);

  render(<NewMeeting groupId="group-1" />);
  await user.type(screen.getByLabelText("מקום"), "ברר");
  await user.click(screen.getByRole("button", { name: "פתח פגישה" }));

  expect(
    await screen.findByText(/לא הצלחנו לזהות את המקום/)
  ).toBeInTheDocument();
  expect(screen.getByLabelText("מקום")).toBeDisabled();

  await user.click(screen.getByRole("button", { name: "פתח פגישה" }));
  const [, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
  expect(JSON.parse(init.body as string)).toEqual({});
  expect(pushMock).toHaveBeenCalledWith("/meetings/meeting-1");
});

test("locks the field when the server says lookups are already used up", async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        jsonResponse(
          { error: "venue_lookup_blocked", venue: "בר", attemptsLeft: 0 },
          409
        )
      )
    )
  );

  render(<NewMeeting groupId="group-1" />);
  await user.type(screen.getByLabelText("מקום"), "בר");
  await user.click(screen.getByRole("button", { name: "פתח פגישה" }));

  expect(
    await screen.findByText(
      "לא הצלחנו לזהות את המקום. אפשר לפתוח את הפגישה בלי מקום מסוים, והסוכן יבחר."
    )
  ).toBeInTheDocument();
  expect(screen.getByLabelText("מקום")).toBeDisabled();
});

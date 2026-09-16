import { afterEach, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewMeeting } from "./NewMeeting";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
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
  const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({}, 201)));
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
  expect(pushMock).toHaveBeenCalledWith("/groups/group-1");
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

test("the time field is disabled until a date is chosen", async () => {
  render(<NewMeeting groupId="group-1" />);
  expect(screen.getByLabelText(/^שעה/)).toBeDisabled();
});

test("clearing the date also clears an already-chosen time", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({}, 201)));
  vi.stubGlobal("fetch", fetchMock);

  render(<NewMeeting groupId="group-1" />);

  const dateInput = screen.getByLabelText("תאריך");
  await user.type(dateInput, "2026-09-20");
  const timeInput = screen.getByLabelText(/^שעה/);
  await user.type(timeInput, "20:00");

  await user.clear(dateInput);
  expect(timeInput).toBeDisabled();

  await user.click(screen.getByRole("button", { name: "פתח פגישה" }));
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(init.body as string)).toEqual({});
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

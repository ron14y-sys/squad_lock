import { afterEach, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResponseControls } from "./ResponseControls";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("approving posts kind: approve and reports back", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({})));
  vi.stubGlobal("fetch", fetchMock);
  const onResponded = vi.fn();

  render(
    <ResponseControls
      meetingId="meeting-1"
      myStatus="pending"
      remainingCycles={3}
      disabled={false}
      onResponded={onResponded}
    />
  );

  await user.click(screen.getByRole("button", { name: "מאשר/ת" }));

  const [url, init] = fetchMock.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  expect(url).toBe("/api/meetings/meeting-1/respond");
  expect(JSON.parse(init.body as string)).toEqual({ kind: "approve" });
  expect(onResponded).toHaveBeenCalledOnce();
});

test("can't-make-it posts kind: cant_make_it", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({})));
  vi.stubGlobal("fetch", fetchMock);

  render(
    <ResponseControls
      meetingId="meeting-1"
      myStatus="pending"
      remainingCycles={3}
      disabled={false}
      onResponded={vi.fn()}
    />
  );

  await user.click(screen.getByRole("button", { name: "לא יכול/ה להגיע" }));

  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(init.body as string)).toEqual({ kind: "cant_make_it" });
});

test("something doesn't work shows the remaining cycle count and requires text", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({})));
  vi.stubGlobal("fetch", fetchMock);

  render(
    <ResponseControls
      meetingId="meeting-1"
      myStatus="pending"
      remainingCycles={2}
      disabled={false}
      onResponded={vi.fn()}
    />
  );

  await user.click(
    screen.getByRole("button", { name: "משהו כאן לא מתאים לי" })
  );
  expect(screen.getByText(/נותרו 2 ניסיונות/)).toBeInTheDocument();

  const sendButton = screen.getByRole("button", { name: "שלח" });
  expect(sendButton).toBeDisabled();

  await user.type(screen.getByPlaceholderText("מה לא מתאים?"), "רועש מדי");
  expect(sendButton).not.toBeDisabled();
  await user.click(sendButton);

  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(init.body as string)).toEqual({
    kind: "doesnt_suit",
    reasonText: "רועש מדי",
  });
});

test("an amendment sends only the fields that were filled in, meeting-scoped", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({})));
  vi.stubGlobal("fetch", fetchMock);

  render(
    <ResponseControls
      meetingId="meeting-1"
      myStatus="pending"
      remainingCycles={3}
      disabled={false}
      onResponded={vi.fn()}
    />
  );

  await user.click(screen.getByRole("button", { name: "המצב שלי הערב שונה" }));

  const submitButton = screen.getByRole("button", { name: "עדכן" });
  expect(submitButton).toBeDisabled();

  await user.selectOptions(screen.getByRole("combobox"), "car");
  expect(submitButton).not.toBeDisabled();
  await user.click(submitButton);

  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(init.body as string)).toEqual({
    kind: "amendment",
    mobilityWindows: [
      {
        mode: "car",
        available: false,
        window: { weekdays: [], from: "00:00", to: "23:59" },
      },
    ],
  });
});

test("shows a friendly message when the meeting is no longer open", async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        jsonResponse({ error: "This meeting is no longer open." }, 409)
      )
    )
  );

  render(
    <ResponseControls
      meetingId="meeting-1"
      myStatus="pending"
      remainingCycles={3}
      disabled={false}
      onResponded={vi.fn()}
    />
  );

  await user.click(screen.getByRole("button", { name: "מאשר/ת" }));

  expect(
    await screen.findByText("הפגישה הזו כבר לא פתוחה לתגובות.")
  ).toBeInTheDocument();
});

test("disables every control when the meeting is closed", () => {
  render(
    <ResponseControls
      meetingId="meeting-1"
      myStatus="approved"
      remainingCycles={3}
      disabled
      onResponded={vi.fn()}
    />
  );

  expect(screen.getByRole("button", { name: "מאשר/ת" })).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "לא יכול/ה להגיע" })
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "משהו כאן לא מתאים לי" })
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "המצב שלי הערב שונה" })
  ).toBeDisabled();
});

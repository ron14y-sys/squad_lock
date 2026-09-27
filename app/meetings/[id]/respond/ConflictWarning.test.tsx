import { afterEach, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConflictWarning } from "./ConflictWarning";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const CONFLICT = {
  meetingId: "meeting-2",
  groupName: "סועדים בשקט",
  venueName: "טרטוריה לוינסקי",
  start: "2026-09-15T17:30:00.000Z",
};

function renderWarning(onResolved = vi.fn()) {
  render(
    <ConflictWarning
      meetingId="meeting-1"
      thisMeetingName="בית קפה נורדאו"
      conflicts={[CONFLICT]}
      onResolved={onResolved}
    />
  );
  return onResolved;
}

function lastBody(fetchMock: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchMock.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  return { url, body: JSON.parse(init.body as string) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("says what approving here would do to the other meeting, before the press", () => {
  renderWarning();

  expect(screen.getByText(/סועדים בשקט · טרטוריה לוינסקי/)).toBeInTheDocument();
  expect(
    screen.getByText("אם תאשר את הפגישה הזו, הפגישה ההיא תחזור לשקלול בלעדייך.")
  ).toBeInTheDocument();
});

test("keep both persists the dismissal and reports back", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ok: true })));
  vi.stubGlobal("fetch", fetchMock);
  const onResolved = renderWarning();

  await user.click(
    screen.getByRole("button", { name: "אלה לא מתנגשות — השאר את שתיהן" })
  );

  const { url, body } = lastBody(fetchMock);
  expect(url).toBe("/api/meetings/meeting-1/conflict");
  expect(body).toEqual({ kind: "keep_both", otherMeetingId: "meeting-2" });
  expect(onResolved).toHaveBeenCalledOnce();
});

test("one needs to change asks which one, and can send either back", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ok: true })));
  vi.stubGlobal("fetch", fetchMock);
  const onResolved = renderWarning();

  await user.click(
    screen.getByRole("button", { name: "אחת מהן צריכה להשתנות" })
  );
  expect(screen.getByText(/איזו מהן לשנות/)).toBeInTheDocument();

  await user.click(
    screen.getByRole("button", { name: "שנה את הפגישה בסועדים בשקט" })
  );

  expect(lastBody(fetchMock).body).toEqual({
    kind: "send_back",
    targetMeetingId: "meeting-2",
  });
  expect(onResolved).toHaveBeenCalledOnce();
});

test("can send this meeting back instead", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ok: true })));
  vi.stubGlobal("fetch", fetchMock);
  renderWarning();

  await user.click(
    screen.getByRole("button", { name: "אחת מהן צריכה להשתנות" })
  );
  await user.click(screen.getByRole("button", { name: /שנה את הפגישה הזו/ }));

  expect(lastBody(fetchMock).body).toEqual({
    kind: "send_back",
    targetMeetingId: "meeting-1",
  });
});

test("shows a message and does not report success when the server refuses", async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        jsonResponse(
          { error: "This meeting can no longer be sent back to weighing." },
          409
        )
      )
    )
  );
  const onResolved = renderWarning();

  await user.click(
    screen.getByRole("button", { name: "אחת מהן צריכה להשתנות" })
  );
  await user.click(screen.getByRole("button", { name: /שנה את הפגישה הזו/ }));

  expect(
    await screen.findByText("אי אפשר להחזיר את הפגישה הזו לשקלול כרגע.")
  ).toBeInTheDocument();
  expect(onResolved).not.toHaveBeenCalled();
});

import { afterEach, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StuckPanel } from "./StuckPanel";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof StuckPanel>> = {}
) {
  const onCancelled = vi.fn();
  render(
    <StuckPanel
      meetingId="meeting-1"
      groupId="group-1"
      initiatorName="אלדד"
      isInitiator={false}
      hasProposal
      rejections={[{ by: "דני", reasonText: "רועש מדי" }]}
      onCancelled={onCancelled}
      {...overrides}
    />
  );
  return onCancelled;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("explains why the search stopped and what people said along the way", () => {
  renderPanel();

  expect(screen.getByText("הפגישה הזו תקועה")).toBeInTheDocument();
  expect(screen.getByText(/ניסינו שלוש פעמים/)).toBeInTheDocument();
  expect(screen.getByText(/דני: "רועש מדי"/)).toBeInTheDocument();
});

test("points to approving the best option, and to starting a new meeting", () => {
  renderPanel();

  expect(screen.getByText(/מאשרים את ההצעה הטובה ביותר/)).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "ופותחים פגישה חדשה" })
  ).toHaveAttribute("href", "/groups/group-1/new");
});

test("does not suggest approving a best option that does not exist", () => {
  renderPanel({ hasProposal: false });

  expect(
    screen.queryByText(/מאשרים את ההצעה הטובה ביותר/)
  ).not.toBeInTheDocument();
});

test("only the initiator gets a cancel button; everyone else is told who can", () => {
  renderPanel({ isInitiator: false });

  expect(
    screen.queryByRole("button", { name: "בטל את הפגישה" })
  ).not.toBeInTheDocument();
  expect(screen.getByText(/רק אלדד, שפתח.ה את הפגישה/)).toBeInTheDocument();
});

test("the initiator confirms before cancelling, then reports back", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ok: true })));
  vi.stubGlobal("fetch", fetchMock);
  const onCancelled = renderPanel({ isInitiator: true });

  await user.click(screen.getByRole("button", { name: "בטל את הפגישה" }));
  expect(fetchMock).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "כן, בטל" }));

  const [url, init] = fetchMock.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  expect(url).toBe("/api/meetings/meeting-1/cancel");
  expect(init.method).toBe("POST");
  expect(onCancelled).toHaveBeenCalledOnce();
});

test("backing out of the confirmation cancels nothing", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  renderPanel({ isInitiator: true });

  await user.click(screen.getByRole("button", { name: "בטל את הפגישה" }));
  await user.click(screen.getByRole("button", { name: "לא" }));

  expect(fetchMock).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "בטל את הפגישה" })
  ).toBeInTheDocument();
});

test("shows a message and does not report success when the server refuses", async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        jsonResponse({ error: "Only a stuck meeting can be cancelled." }, 409)
      )
    )
  );
  const onCancelled = renderPanel({ isInitiator: true });

  await user.click(screen.getByRole("button", { name: "בטל את הפגישה" }));
  await user.click(screen.getByRole("button", { name: "כן, בטל" }));

  expect(
    await screen.findByText("הפגישה הזו כבר לא תקועה.")
  ).toBeInTheDocument();
  expect(onCancelled).not.toHaveBeenCalled();
});

import { afterEach, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AcceptInvitation } from "./AcceptInvitation";

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

test("accepting successfully shows a link to the group", async () => {
  const user = userEvent.setup();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse({ groupId: "group-1" }));
  vi.stubGlobal("fetch", fetchMock);

  render(<AcceptInvitation token="tok-123" />);
  await user.click(screen.getByRole("button", { name: "הצטרף לקבוצה" }));

  expect(await screen.findByText("הצטרפת לקבוצה!")).toBeInTheDocument();
  const link = screen.getByRole("link", { name: "מעבר לקבוצה" });
  expect(link).toHaveAttribute("href", "/groups/group-1");

  expect(fetchMock).toHaveBeenCalledWith("/api/invitations/tok-123/accept", {
    method: "POST",
  });
});

test("shows a sign-in prompt when unauthenticated", async () => {
  const user = userEvent.setup();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse({ error: "Not signed in." }, 401));
  vi.stubGlobal("fetch", fetchMock);

  render(<AcceptInvitation token="tok-123" />);
  await user.click(screen.getByRole("button", { name: "הצטרף לקבוצה" }));

  expect(
    await screen.findByText("התחבר עם Google כדי להצטרף לקבוצה.")
  ).toBeInTheDocument();
});

test("shows a translated message for a known error", async () => {
  const user = userEvent.setup();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      jsonResponse(
        { error: "This invitation was sent to a different address." },
        403
      )
    );
  vi.stubGlobal("fetch", fetchMock);

  render(<AcceptInvitation token="tok-123" />);
  await user.click(screen.getByRole("button", { name: "הצטרף לקבוצה" }));

  expect(
    await screen.findByText(
      "ההזמנה הזו נשלחה לכתובת אימייל אחרת מזו שאיתה התחברת."
    )
  ).toBeInTheDocument();
});

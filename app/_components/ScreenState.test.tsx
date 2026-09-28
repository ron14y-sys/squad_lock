import { afterEach, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ScreenState } from "./ScreenState";

vi.mock("next/navigation", () => ({
  usePathname: () => "/groups/g1",
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

test("loading shows its message inside a busy status region", () => {
  render(<ScreenState kind="loading">טוען את הפגישה…</ScreenState>);

  const region = screen.getByRole("status");
  expect(region).toHaveAttribute("aria-busy", "true");
  expect(screen.getByText("טוען את הפגישה…")).toBeInTheDocument();
});

test("error is an alert, and its retry button reloads the page", async () => {
  const user = userEvent.setup();
  const reload = vi.fn();
  vi.stubGlobal("location", { ...window.location, reload });

  render(<ScreenState kind="error">לא הצלחנו לטעון.</ScreenState>);

  expect(screen.getByRole("alert")).toHaveTextContent("לא הצלחנו לטעון.");
  await user.click(screen.getByRole("button", { name: "נסה שוב" }));
  expect(reload).toHaveBeenCalledTimes(1);
});

test("a signed-out notice offers sign-in and returns to the same page", () => {
  render(
    <ScreenState kind="notice" signIn>
      התחבר כדי לראות פגישה.
    </ScreenState>
  );

  expect(screen.getByRole("link", { name: "התחבר" })).toHaveAttribute(
    "href",
    "/api/auth/signin?callbackUrl=%2Fgroups%2Fg1"
  );
});

test("a plain notice and an empty state have no button to press", () => {
  const { rerender } = render(
    <ScreenState kind="notice">הקבוצה הזו לא נמצאה.</ScreenState>
  );
  expect(screen.getByText("הקבוצה הזו לא נמצאה.")).toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();

  rerender(
    <ScreenState kind="empty">אין עדיין פגישות בקבוצה הזו.</ScreenState>
  );
  expect(screen.getByText("אין עדיין פגישות בקבוצה הזו.")).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

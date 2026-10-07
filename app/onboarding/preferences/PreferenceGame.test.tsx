import { expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PreferenceGame } from "./PreferenceGame";

// #217 left the game with one question — budget — until #218 adds kind of
// place and cuisine.

test("asks the budget question and reports the answer", async () => {
  const user = userEvent.setup();
  const onComplete = vi.fn();
  render(<PreferenceGame onComplete={onComplete} />);

  expect(
    screen.getByText("תקציב סטודנטים או פינוק חד-פעמי?")
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "פינוק חד-פעמי" }));

  expect(onComplete).toHaveBeenCalledOnce();
  expect(onComplete).toHaveBeenCalledWith({ budget: "splurge" });
  expect(screen.getByRole("heading", { name: "זה אתה." })).toBeInTheDocument();
});

test("no longer asks about noise, activity or adventurous food (#217)", () => {
  render(<PreferenceGame />);

  expect(screen.queryByText("בר רועש או בית קפה שקט?")).not.toBeInTheDocument();
  expect(
    screen.queryByText("טיול בטבע או סיור במוזיאון?")
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText("אוכל מוכר ובטוח או משהו הרפתקני?")
  ).not.toBeInTheDocument();
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "1");
});

test("declining the question completes the game with nothing stored (#86)", async () => {
  const user = userEvent.setup();
  const onComplete = vi.fn();
  render(<PreferenceGame onComplete={onComplete} />);

  await user.click(screen.getByRole("button", { name: "זה לא משנה לי — דלג" }));

  expect(onComplete).toHaveBeenCalledWith({});
  expect(screen.getByRole("heading", { name: "זה אתה." })).toBeInTheDocument();
});

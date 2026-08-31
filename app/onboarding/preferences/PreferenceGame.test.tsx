import { expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PreferenceGame } from "./PreferenceGame";

test("walks through all four questions and reports the answers", async () => {
  const user = userEvent.setup();
  const onComplete = vi.fn();
  render(<PreferenceGame onComplete={onComplete} />);

  expect(screen.getByText("בר רועש או בית קפה שקט?")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "בר רועש" }));

  expect(screen.getByText("טיול בטבע או סיור במוזיאון?")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "סיור במוזיאון" }));

  expect(
    screen.getByText("תקציב סטודנטים או פינוק חד-פעמי?")
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "פינוק חד-פעמי" }));

  expect(
    screen.getByText("אוכל מוכר ובטוח או משהו הרפתקני?")
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "אוכל מוכר" }));

  expect(onComplete).toHaveBeenCalledOnce();
  expect(onComplete).toHaveBeenCalledWith({
    noiseLevel: "lively",
    activityStyle: "cultural",
    budget: "splurge",
    cuisine: "familiar",
  });
  expect(screen.getByRole("heading", { name: "זה אתה." })).toBeInTheDocument();
});

test("shows a progress indicator that advances with each answer", async () => {
  const user = userEvent.setup();
  render(<PreferenceGame />);

  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
  await user.click(screen.getByRole("button", { name: "בר רועש" }));
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2");
});

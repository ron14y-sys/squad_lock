import { expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PreferenceGame } from "./PreferenceGame";

test("walks through all four questions and reports the answers", async () => {
  const user = userEvent.setup();
  const onComplete = vi.fn();
  render(<PreferenceGame onComplete={onComplete} />);

  expect(screen.getByText("Loud bar or quiet café?")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Loud bar" }));

  expect(
    screen.getByText("Hike in nature or a museum tour?")
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Museum tour" }));

  expect(
    screen.getByText("Student budget or once-in-a-lifetime splurge?")
  ).toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Once-in-a-lifetime splurge" })
  );

  expect(
    screen.getByText("Reliable comfort food or something adventurous?")
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Comfort food" }));

  expect(onComplete).toHaveBeenCalledOnce();
  expect(onComplete).toHaveBeenCalledWith({
    noiseLevel: "lively",
    activityStyle: "cultural",
    budget: "splurge",
    cuisine: "familiar",
  });
  expect(
    screen.getByRole("heading", { name: "That's you." })
  ).toBeInTheDocument();
});

test("shows a progress indicator that advances with each answer", async () => {
  const user = userEvent.setup();
  render(<PreferenceGame />);

  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
  await user.click(screen.getByRole("button", { name: "Loud bar" }));
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2");
});

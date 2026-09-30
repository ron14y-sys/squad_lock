import { expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Landing } from "./Landing";

test("shows the app name and tagline", () => {
  render(<Landing onGoogleSignIn={vi.fn()} />);

  expect(screen.getByText("SquadLock")).toBeInTheDocument();
  expect(screen.getByText("לתאם מפגשים עם החברים שלך.")).toBeInTheDocument();
});

test("submits the Google sign-in action when the button is pressed (#171)", async () => {
  const user = userEvent.setup();
  const onGoogleSignIn = vi.fn().mockResolvedValue(undefined);

  render(<Landing onGoogleSignIn={onGoogleSignIn} />);
  await user.click(screen.getByRole("button", { name: "התחבר עם Google" }));

  expect(onGoogleSignIn).toHaveBeenCalledTimes(1);
});

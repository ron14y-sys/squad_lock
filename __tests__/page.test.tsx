import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { Landing } from "@/app/_components/Landing";

// The home page itself is an async server component (it redirects a signed-in
// user to /groups), which Vitest cannot render — so the landing it falls back
// to is what is tested here.
test("the landing page renders its heading", () => {
  render(<Landing />);

  expect(
    screen.getByRole("heading", {
      level: 1,
      name: /squadlock/i,
    })
  ).toBeInTheDocument();
});

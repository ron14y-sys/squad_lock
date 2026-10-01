import { expect, test } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Logo3D } from "./Logo3D";

test("renders as a link to href when given one", () => {
  render(<Logo3D href="/groups" />);

  const link = screen.getByRole("link", { name: "SquadLock" });
  expect(link).toHaveAttribute("href", "/groups");
});

test("renders as plain text, not a link, when no href is given", () => {
  render(<Logo3D />);

  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.getByText("SquadLock")).toBeInTheDocument();
});

test("tracks the pointer into CSS custom properties for the tilt", () => {
  render(<Logo3D href="/groups" />);

  const card = screen.getByText("SquadLock").parentElement as HTMLElement;
  card.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 100, height: 40 }) as DOMRect;

  fireEvent.pointerMove(card, { clientX: 100, clientY: 0 });

  // Pointer at the far corner — both tilt axes should have moved off 0deg.
  expect(card.style.getPropertyValue("--tilt-x")).not.toBe("");
  expect(card.style.getPropertyValue("--tilt-y")).not.toBe("0deg");

  fireEvent.pointerLeave(card);
  expect(card.style.getPropertyValue("--tilt-x")).toBe("0deg");
  expect(card.style.getPropertyValue("--tilt-y")).toBe("0deg");
});

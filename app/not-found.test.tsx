import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import NotFound from "./not-found";

test("#190: says the page doesn't exist and links back home", () => {
  render(<NotFound />);

  expect(
    screen.getByText("הדף הזה לא קיים — אולי הקישור שגוי, או שהדף הוזז.")
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "חזרה למסך הבית" })).toHaveAttribute(
    "href",
    "/"
  );
});

import { expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PreferenceGame } from "./PreferenceGame";

// #217 dropped noise, activity style and "familiar or adventurous" from the
// vocabulary. #218 is the three questions that replaced them: budget (a
// left/right card, unchanged), then kind of place and cuisine (#218, both
// multi-select chips + a "continue" button).

test("asks the budget question and reports the answer", async () => {
  const user = userEvent.setup();
  const onComplete = vi.fn();
  render(<PreferenceGame onComplete={onComplete} />);

  expect(
    screen.getByText("תקציב סטודנטים או פינוק חד-פעמי?")
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "פינוק חד-פעמי" }));

  // Budget answered, two multi-select questions still ahead.
  expect(onComplete).not.toHaveBeenCalled();
  expect(
    screen.getByText("אילו סוגי מקומות הכי מתאימים לך?")
  ).toBeInTheDocument();
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
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "3");
});

test("declining every question completes the game with nothing stored (#86)", async () => {
  const user = userEvent.setup();
  const onComplete = vi.fn();
  render(<PreferenceGame onComplete={onComplete} />);

  await user.click(screen.getByRole("button", { name: "זה לא משנה לי — דלג" }));
  await user.click(screen.getByRole("button", { name: "זה לא משנה לי — דלג" }));
  await user.click(screen.getByRole("button", { name: "זה לא משנה לי — דלג" }));

  expect(onComplete).toHaveBeenCalledWith({});
  expect(screen.getByRole("heading", { name: "זה אתה." })).toBeInTheDocument();
});

async function reachVenueKinds(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "זה לא משנה לי — דלג" }));
}

test("toggling chips and continuing reports the kinds of place chosen (#218)", async () => {
  const user = userEvent.setup();
  const onComplete = vi.fn();
  render(<PreferenceGame onComplete={onComplete} />);
  await reachVenueKinds(user);

  await user.click(screen.getByRole("button", { name: "בר" }));
  await user.click(screen.getByRole("button", { name: "בית קפה" }));
  await user.click(screen.getByRole("button", { name: "המשך" }));

  // Cuisine is next — skip it to finish and see what venueKinds reported.
  await user.click(screen.getByRole("button", { name: "זה לא משנה לי — דלג" }));

  expect(onComplete).toHaveBeenCalledWith({ venueKinds: ["bar", "cafe"] });
});

test("un-toggling a chip removes it from the selection", async () => {
  const user = userEvent.setup();
  render(<PreferenceGame />);
  await reachVenueKinds(user);

  const bar = screen.getByRole("button", { name: "בר" });
  await user.click(bar);
  expect(bar).toHaveAttribute("aria-pressed", "true");
  await user.click(bar);
  expect(bar).toHaveAttribute("aria-pressed", "false");
});

test("continuing with no chip selected leaves the field unset, not an empty list (#86)", async () => {
  const user = userEvent.setup();
  const onComplete = vi.fn();
  render(<PreferenceGame onComplete={onComplete} />);
  await reachVenueKinds(user);

  await user.click(screen.getByRole("button", { name: "המשך" }));
  await user.click(screen.getByRole("button", { name: "זה לא משנה לי — דלג" }));

  expect(onComplete).toHaveBeenCalledWith({});
});

test("cuisine is a real multi-select question too", async () => {
  const user = userEvent.setup();
  const onComplete = vi.fn();
  render(<PreferenceGame onComplete={onComplete} />);
  await reachVenueKinds(user);
  await user.click(screen.getByRole("button", { name: "המשך" }));

  expect(screen.getByText("איזה אוכל הכי מדבר אליך?")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "סושי / יפני" }));
  await user.click(screen.getByRole("button", { name: "המשך" }));

  expect(onComplete).toHaveBeenCalledWith({ cuisines: ["sushi"] });
});

test("starts a multi-select question from the saved answer, chips pre-selected (#203)", async () => {
  const user = userEvent.setup();
  render(<PreferenceGame initial={{ venueKinds: ["bar", "restaurant"] }} />);
  await reachVenueKinds(user);

  expect(screen.getByRole("button", { name: "בר" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  expect(screen.getByRole("button", { name: "בית קפה" })).toHaveAttribute(
    "aria-pressed",
    "false"
  );
  expect(screen.getByRole("button", { name: "מסעדה" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
});

test("skipping a multi-select question keeps the saved answer rather than an in-progress toggle", async () => {
  const user = userEvent.setup();
  const onComplete = vi.fn();
  render(
    <PreferenceGame initial={{ venueKinds: ["bar"] }} onComplete={onComplete} />
  );
  await reachVenueKinds(user);

  // Toggle it off, then skip instead of continuing — the toggle was never committed.
  await user.click(screen.getByRole("button", { name: "בר" }));
  await user.click(screen.getByRole("button", { name: "דלג — השאר כמו שהיה" }));
  await user.click(screen.getByRole("button", { name: "זה לא משנה לי — דלג" }));

  expect(onComplete).toHaveBeenCalledWith({ venueKinds: ["bar"] });
});

test("an old profile holding noiseLevel shows nothing for it in the summary", async () => {
  const user = userEvent.setup();
  render(
    <PreferenceGame
      // A pre-#217 shape, cast past the current type — exactly what
      // softPreferencesFromJson already has to tolerate on read.
      initial={{ noiseLevel: "lively" } as never}
    />
  );

  await user.click(screen.getByRole("button", { name: "זה לא משנה לי — דלג" }));
  await user.click(screen.getByRole("button", { name: "זה לא משנה לי — דלג" }));
  await user.click(screen.getByRole("button", { name: "זה לא משנה לי — דלג" }));

  expect(
    screen.getByText("לא משנה לי · לא משנה לי · לא משנה לי")
  ).toBeInTheDocument();
});

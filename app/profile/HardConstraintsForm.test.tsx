import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HardConstraintsForm } from "./HardConstraintsForm";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const EMPTY_PROFILE = {
  hardConstraints: { dietary: [], allergies: [], unavailable: [] },
  softPreferences: {},
  home: null,
  homeNeighbourhood: null,
  toleranceKm: 5,
  recurringMobilityRules: [],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("loads the existing profile and pre-selects saved constraints", async () => {
  fetchMock.mockResolvedValueOnce(
    jsonResponse({
      ...EMPTY_PROFILE,
      hardConstraints: {
        dietary: ["כשר"],
        allergies: [],
        unavailable: [],
      },
    })
  );

  render(<HardConstraintsForm />);

  const kosher = await screen.findByRole("button", { name: "כשר" });
  expect(kosher).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "צמחוני" })).toHaveAttribute(
    "aria-pressed",
    "false"
  );
});

test("toggling a constraint and saving PUTs the updated hard constraints", async () => {
  const user = userEvent.setup();
  fetchMock.mockResolvedValueOnce(jsonResponse(EMPTY_PROFILE));
  render(<HardConstraintsForm />);

  await screen.findByRole("button", { name: "כשר" });
  await user.click(screen.getByRole("button", { name: "אגוזים" }));

  fetchMock.mockResolvedValueOnce(
    jsonResponse({
      ...EMPTY_PROFILE,
      hardConstraints: { dietary: [], allergies: ["אגוזים"], unavailable: [] },
    })
  );
  await user.click(screen.getByRole("button", { name: "שמור" }));

  await waitFor(() => expect(screen.getByText("נשמר.")).toBeInTheDocument());

  const putCall = fetchMock.mock.calls.find(
    ([, init]) => init?.method === "PUT"
  );
  expect(putCall).toBeDefined();
  const [url, init] = putCall!;
  expect(url).toBe("/api/preferences");
  expect(JSON.parse(init.body)).toEqual({
    hardConstraints: { dietary: [], allergies: ["אגוזים"], unavailable: [] },
  });
});

test("adding a fixed unavailable window shows it in the list", async () => {
  const user = userEvent.setup();
  fetchMock.mockResolvedValueOnce(jsonResponse(EMPTY_PROFILE));
  render(<HardConstraintsForm />);

  await screen.findByRole("button", { name: "כשר" });

  const unavailableSection = screen
    .getByText("שעות קבועות שאינך זמין/ה")
    .closest("section")!;
  await user.click(
    within(unavailableSection).getByRole("button", { name: "ו׳" })
  );
  await user.click(
    within(unavailableSection).getByRole("button", { name: "הוסף" })
  );

  expect(
    within(unavailableSection).getByText(/ו׳ · 18:00–21:00/)
  ).toBeInTheDocument();
});

test("shows a sign-in prompt instead of the form when the user is unauthenticated", async () => {
  fetchMock.mockResolvedValueOnce(
    jsonResponse({ error: "Not signed in." }, 401)
  );
  render(<HardConstraintsForm />);

  expect(
    await screen.findByText("התחבר כדי להגדיר את האילוצים שלך.")
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "כשר" })).not.toBeInTheDocument();
});

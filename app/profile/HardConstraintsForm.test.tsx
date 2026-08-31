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
        dietary: ["Kosher"],
        allergies: [],
        unavailable: [],
      },
    })
  );

  render(<HardConstraintsForm />);

  const kosher = await screen.findByRole("button", { name: "Kosher" });
  expect(kosher).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Vegetarian" })).toHaveAttribute(
    "aria-pressed",
    "false"
  );
});

test("toggling a constraint and saving PUTs the updated hard constraints", async () => {
  const user = userEvent.setup();
  fetchMock.mockResolvedValueOnce(jsonResponse(EMPTY_PROFILE));
  render(<HardConstraintsForm />);

  await screen.findByRole("button", { name: "Kosher" });
  await user.click(screen.getByRole("button", { name: "Nuts" }));

  fetchMock.mockResolvedValueOnce(
    jsonResponse({
      ...EMPTY_PROFILE,
      hardConstraints: { dietary: [], allergies: ["Nuts"], unavailable: [] },
    })
  );
  await user.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(screen.getByText("Saved.")).toBeInTheDocument());

  const putCall = fetchMock.mock.calls.find(
    ([, init]) => init?.method === "PUT"
  );
  expect(putCall).toBeDefined();
  const [url, init] = putCall!;
  expect(url).toBe("/api/preferences");
  expect(JSON.parse(init.body)).toEqual({
    hardConstraints: { dietary: [], allergies: ["Nuts"], unavailable: [] },
  });
});

test("adding a fixed unavailable window shows it in the list", async () => {
  const user = userEvent.setup();
  fetchMock.mockResolvedValueOnce(jsonResponse(EMPTY_PROFILE));
  render(<HardConstraintsForm />);

  await screen.findByRole("button", { name: "Kosher" });

  const unavailableSection = screen
    .getByText("Fixed unavailable hours")
    .closest("section")!;
  await user.click(
    within(unavailableSection).getByRole("button", { name: "fri" })
  );
  await user.click(
    within(unavailableSection).getByRole("button", { name: "Add" })
  );

  expect(
    within(unavailableSection).getByText(/friday · 18:00–21:00/i)
  ).toBeInTheDocument();
});

test("shows a sign-in prompt instead of the form when the user is unauthenticated", async () => {
  fetchMock.mockResolvedValueOnce(
    jsonResponse({ error: "Not signed in." }, 401)
  );
  render(<HardConstraintsForm />);

  expect(
    await screen.findByText("Sign in to set your constraints.")
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Kosher" })
  ).not.toBeInTheDocument();
});

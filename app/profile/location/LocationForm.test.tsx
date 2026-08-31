import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LocationForm } from "./LocationForm";

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

test("loads the existing profile and pre-fills the saved values", async () => {
  fetchMock.mockResolvedValueOnce(
    jsonResponse({
      ...EMPTY_PROFILE,
      homeNeighbourhood: "פלורנטין, תל אביב",
      toleranceKm: 8,
    })
  );

  render(<LocationForm />);

  expect(
    await screen.findByDisplayValue("פלורנטין, תל אביב")
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "חצי מהעיר" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
});

test("saving sends the neighbourhood name and kilometres, not the label", async () => {
  const user = userEvent.setup();
  fetchMock.mockResolvedValueOnce(jsonResponse(EMPTY_PROFILE));
  render(<LocationForm />);

  await screen.findByRole("button", { name: "ברגל" });
  await user.type(
    screen.getByPlaceholderText("לדוגמה: רוטשילד, תל אביב"),
    "נווה צדק"
  );
  await user.click(screen.getByRole("button", { name: "בכל מקום" }));

  fetchMock.mockResolvedValueOnce(jsonResponse(EMPTY_PROFILE));
  await user.click(screen.getByRole("button", { name: "שמור" }));

  await waitFor(() => expect(screen.getByText("נשמר.")).toBeInTheDocument());

  const putCall = fetchMock.mock.calls.find(
    ([, init]) => init?.method === "PUT"
  );
  const [, init] = putCall!;
  expect(JSON.parse(init.body)).toEqual({
    homeNeighbourhood: "נווה צדק",
    toleranceKm: 20,
    recurringMobilityRules: [],
  });
});

test("adding a recurring mobility rule shows it in the list", async () => {
  const user = userEvent.setup();
  fetchMock.mockResolvedValueOnce(jsonResponse(EMPTY_PROFILE));
  render(<LocationForm />);

  await screen.findByRole("button", { name: "ברגל" });

  const rulesSection = screen
    .getByText("כללי ניידות קבועים")
    .closest("section")!;
  await user.click(within(rulesSection).getByRole("button", { name: "ו׳" }));
  await user.click(within(rulesSection).getByRole("button", { name: "הוסף" }));

  expect(within(rulesSection).getByText(/ו׳ · בלי רכב/)).toBeInTheDocument();
});

test("shows a sign-in prompt instead of the form when unauthenticated", async () => {
  fetchMock.mockResolvedValueOnce(
    jsonResponse({ error: "Not signed in." }, 401)
  );
  render(<LocationForm />);

  expect(
    await screen.findByText("התחבר כדי להגדיר את המיקום שלך ומרחק הנסיעה.")
  ).toBeInTheDocument();
});

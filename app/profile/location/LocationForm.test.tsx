import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { findNeighbourhoodById } from "@/lib/geo/neighbourhoods";
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
      home: { lat: 32.0563, lng: 34.769 },
      homeNeighbourhood: "פלורנטין, תל אביב",
      toleranceKm: 8,
    })
  );

  render(<LocationForm />);

  expect(
    await screen.findByRole("combobox", { name: "שכונת מגורים" })
  ).toHaveDisplayValue("פלורנטין, תל אביב");
  expect(screen.getByRole("button", { name: "חצי מהעיר" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
});

test("saving sends the picked area's name AND its coordinates (#132)", async () => {
  const user = userEvent.setup();
  fetchMock.mockResolvedValueOnce(jsonResponse(EMPTY_PROFILE));
  render(<LocationForm />);

  await screen.findByRole("button", { name: "ברגל" });
  await user.selectOptions(
    screen.getByRole("combobox", { name: "שכונת מגורים" }),
    "נווה צדק, תל אביב"
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
    homeNeighbourhood: "נווה צדק, תל אביב",
    home: findNeighbourhoodById("ta-neve-tzedek")!.centre,
    toleranceKm: 20,
    recurringMobilityRules: [],
  });
});

test("cannot save until an area is picked", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse(EMPTY_PROFILE));
  render(<LocationForm />);

  await screen.findByRole("button", { name: "ברגל" });

  expect(screen.getByRole("button", { name: "שמור" })).toBeDisabled();
  expect(screen.getByText("בחר אזור מגורים כדי לשמור.")).toBeInTheDocument();
});

test("free text saved before the picker existed is not treated as a pick", async () => {
  // Those profiles hold a name with no coordinates (#132) — the user has to
  // choose again, or the missing point would stay missing.
  fetchMock.mockResolvedValueOnce(
    jsonResponse({ ...EMPTY_PROFILE, homeNeighbourhood: "ליד הים" })
  );
  render(<LocationForm />);

  await screen.findByRole("button", { name: "ברגל" });

  expect(screen.getByRole("button", { name: "שמור" })).toBeDisabled();
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

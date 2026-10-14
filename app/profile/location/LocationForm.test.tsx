import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { findNeighbourhoodById } from "@/lib/geo/neighbourhoods";
import { LocationForm } from "./LocationForm";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/profile/location",
}));

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
  // Opened from the profile, with nowhere to go back to: it stays (#260).
  expect(pushMock).not.toHaveBeenCalled();

  const putCall = fetchMock.mock.calls.find(
    ([, init]) => init?.method === "PUT"
  );
  const [, init] = putCall!;
  expect(JSON.parse(init.body)).toEqual({
    homeNeighbourhood: "נווה צדק, תל אביב",
    home: findNeighbourhoodById("ta-neve-tzedek")!.centre,
    toleranceKm: 30,
    recurringMobilityRules: [],
  });
});

/** Picks an area and presses save, answering the save with `saved`. */
async function pickAndSave(saved: Response) {
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "ברגל" });
  await user.selectOptions(
    screen.getByRole("combobox", { name: "שכונת מגורים" }),
    "נווה צדק, תל אביב"
  );
  fetchMock.mockResolvedValueOnce(saved);
  await user.click(screen.getByRole("button", { name: "שמור" }));
}

test("once saved, goes back to the meeting whose link led here (#260)", async () => {
  pushMock.mockClear();
  fetchMock.mockResolvedValueOnce(jsonResponse(EMPTY_PROFILE));
  render(<LocationForm next="/meetings/m1" />);

  await pickAndSave(jsonResponse(EMPTY_PROFILE));

  await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/meetings/m1"));
});

test("goes nowhere when the save fails (#260)", async () => {
  pushMock.mockClear();
  fetchMock.mockResolvedValueOnce(jsonResponse(EMPTY_PROFILE));
  render(<LocationForm next="/meetings/m1" />);

  await pickAndSave(jsonResponse({}, 500));

  await screen.findByText(/לא הצלחנו לשמור|נסה שוב/);
  expect(pushMock).not.toHaveBeenCalled();
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

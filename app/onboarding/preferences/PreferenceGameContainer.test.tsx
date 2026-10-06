import { afterEach, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PreferenceGameContainer } from "./PreferenceGameContainer";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/** The PUT bodies sent, in order — the first fetch is the GET of saved answers. */
function putBodies(fetchMock: ReturnType<typeof vi.fn>) {
  return (fetchMock.mock.calls as unknown as [string, RequestInit?][])
    .filter(([, init]) => init?.method === "PUT")
    .map(([url, init]) => ({ url, body: JSON.parse(init!.body as string) }));
}

async function playThroughAllFourQuestions(
  user: ReturnType<typeof userEvent.setup>
) {
  await user.click(await screen.findByRole("button", { name: "בר רועש" }));
  await user.click(screen.getByRole("button", { name: "סיור במוזיאון" }));
  await user.click(screen.getByRole("button", { name: "פינוק חד-פעמי" }));
  await user.click(screen.getByRole("button", { name: "אוכל מוכר" }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("saves the answers to /api/preferences the moment the game finishes", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({})));
  vi.stubGlobal("fetch", fetchMock);

  render(<PreferenceGameContainer />);
  await playThroughAllFourQuestions(user);

  expect(await screen.findByText("נשמר.")).toBeInTheDocument();

  const [{ url, body }] = putBodies(fetchMock);
  expect(url).toBe("/api/preferences");
  expect(body).toEqual({
    softPreferences: {
      noiseLevel: "lively",
      activityStyle: "cultural",
      budget: "splurge",
      cuisine: "familiar",
    },
  });
});

test("leads onward to the rest of onboarding once saved (#173)", async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(jsonResponse({})))
  );

  render(<PreferenceGameContainer />);
  await playThroughAllFourQuestions(user);

  expect(await screen.findByRole("link", { name: "להמשיך" })).toHaveAttribute(
    "href",
    "/groups"
  );
});

test("shows a sign-in prompt if the session expired mid-game", async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(jsonResponse({ error: "Not signed in." }, 401)))
  );

  render(<PreferenceGameContainer />);
  await playThroughAllFourQuestions(user);

  expect(
    await screen.findByText("התחבר כדי לשמור את התשובות שלך.")
  ).toBeInTheDocument();
});

test("offers a retry that resends the same answers after a failed save", async () => {
  const user = userEvent.setup();
  const fetchMock = vi
    .fn(() => Promise.resolve(jsonResponse({})))
    .mockResolvedValueOnce(jsonResponse({}))
    .mockResolvedValueOnce(jsonResponse({ error: "boom" }, 500))
    .mockResolvedValueOnce(jsonResponse({}));
  vi.stubGlobal("fetch", fetchMock);

  render(<PreferenceGameContainer />);
  await playThroughAllFourQuestions(user);

  expect(await screen.findByText("לא הצלחנו לשמור.")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "נסה שוב" }));

  expect(await screen.findByText("נשמר.")).toBeInTheDocument();
  const puts = putBodies(fetchMock);
  expect(puts).toHaveLength(2);
  expect(puts[1]!.body).toEqual({
    softPreferences: {
      noiseLevel: "lively",
      activityStyle: "cultural",
      budget: "splurge",
      cuisine: "familiar",
    },
  });
});

test("a fully declined game saves an empty soft-preference set", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({})));
  vi.stubGlobal("fetch", fetchMock);

  render(<PreferenceGameContainer />);
  for (let i = 0; i < 4; i++) {
    await user.click(
      await screen.findByRole("button", { name: "זה לא משנה לי — דלג" })
    );
  }

  expect(await screen.findByText("נשמר.")).toBeInTheDocument();
  expect(putBodies(fetchMock)[0]!.body).toEqual({ softPreferences: {} });
});

test("a replayed game starts from the saved answers, and skipping keeps them", async () => {
  const user = userEvent.setup();
  const fetchMock = vi
    .fn(() => Promise.resolve(jsonResponse({})))
    .mockResolvedValueOnce(
      jsonResponse({
        softPreferences: { noiseLevel: "quiet", budget: "modest" },
      })
    );
  vi.stubGlobal("fetch", fetchMock);

  render(<PreferenceGameContainer />);

  // The saved side is marked, and skipping says it keeps it.
  expect(
    await screen.findByRole("button", { name: "בית קפה שקט" })
  ).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText("הבחירה שלך עד עכשיו")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "דלג — השאר כמו שהיה" }));

  // No saved answer here — the ordinary decline.
  await user.click(screen.getByRole("button", { name: "זה לא משנה לי — דלג" }));
  await user.click(screen.getByRole("button", { name: "דלג — השאר כמו שהיה" }));
  await user.click(screen.getByRole("button", { name: "זה לא משנה לי — דלג" }));

  expect(await screen.findByText("נשמר.")).toBeInTheDocument();
  expect(putBodies(fetchMock)[0]!.body).toEqual({
    softPreferences: { noiseLevel: "quiet", budget: "modest" },
  });
  expect(
    screen.getByText("בית קפה שקט · לא משנה לי · תקציב סטודנטים · לא משנה לי")
  ).toBeInTheDocument();
});

test("a replayed game can change a saved answer", async () => {
  const user = userEvent.setup();
  const fetchMock = vi
    .fn(() => Promise.resolve(jsonResponse({})))
    .mockResolvedValueOnce(
      jsonResponse({ softPreferences: { noiseLevel: "quiet" } })
    );
  vi.stubGlobal("fetch", fetchMock);

  render(<PreferenceGameContainer />);
  await user.click(await screen.findByRole("button", { name: "בר רועש" }));
  for (let i = 0; i < 3; i++) {
    await user.click(
      screen.getByRole("button", { name: "זה לא משנה לי — דלג" })
    );
  }

  expect(await screen.findByText("נשמר.")).toBeInTheDocument();
  expect(putBodies(fetchMock)[0]!.body).toEqual({
    softPreferences: { noiseLevel: "lively" },
  });
});

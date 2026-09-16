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

async function playThroughAllFourQuestions(
  user: ReturnType<typeof userEvent.setup>
) {
  await user.click(screen.getByRole("button", { name: "בר רועש" }));
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

  const [url, init] = fetchMock.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  expect(url).toBe("/api/preferences");
  expect(init).toMatchObject({ method: "PUT" });
  expect(JSON.parse(init!.body as string)).toEqual({
    softPreferences: {
      noiseLevel: "lively",
      activityStyle: "cultural",
      budget: "splurge",
      cuisine: "familiar",
    },
  });
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
    .mockResolvedValueOnce(jsonResponse({ error: "boom" }, 500))
    .mockResolvedValueOnce(jsonResponse({}));
  vi.stubGlobal("fetch", fetchMock);

  render(<PreferenceGameContainer />);
  await playThroughAllFourQuestions(user);

  expect(await screen.findByText("לא הצלחנו לשמור.")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "נסה שוב" }));

  expect(await screen.findByText("נשמר.")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
  const retryInit = calls[1]![1];
  expect(JSON.parse(retryInit.body as string)).toEqual({
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
      screen.getByRole("button", { name: "זה לא משנה לי — דלג" })
    );
  }

  expect(await screen.findByText("נשמר.")).toBeInTheDocument();
  const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
  const declinedInit = calls[0]![1];
  expect(JSON.parse(declinedInit.body as string)).toEqual({
    softPreferences: {},
  });
});

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GroupsList } from "./GroupsList";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const ONE_GROUP = [
  {
    id: "group-1",
    name: "Rothschild Regulars",
    createdAt: "2026-08-01T00:00:00.000Z",
    members: [
      {
        userId: "u1",
        joinedAt: "2026-08-01T00:00:00.000Z",
        user: { name: "Dana", email: "dana@example.com" },
      },
    ],
  },
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("lists the signed-in user's groups with a member count", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse(ONE_GROUP));
  render(<GroupsList />);

  expect(await screen.findByText("Rothschild Regulars")).toBeInTheDocument();
  expect(screen.getByText("1 חברים")).toBeInTheDocument();
});

test("shows an empty state with no groups yet", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse([]));
  render(<GroupsList />);

  expect(await screen.findByText("עדיין אין לך קבוצות.")).toBeInTheDocument();
});

test("creating a group POSTs the name and reloads the list", async () => {
  const user = userEvent.setup();
  fetchMock.mockResolvedValueOnce(jsonResponse([]));
  render(<GroupsList />);

  await screen.findByText("עדיין אין לך קבוצות.");

  fetchMock.mockResolvedValueOnce(
    jsonResponse({ id: "group-2", name: "Neve Tzedek Crew" }, 201)
  );
  fetchMock.mockResolvedValueOnce(
    jsonResponse([
      {
        id: "group-2",
        name: "Neve Tzedek Crew",
        createdAt: "2026-08-01T00:00:00.000Z",
        members: [
          {
            userId: "u1",
            joinedAt: "2026-08-01T00:00:00.000Z",
            user: { name: "Dana", email: "dana@example.com" },
          },
        ],
      },
    ])
  );

  await user.type(screen.getByPlaceholderText("שם הקבוצה"), "Neve Tzedek Crew");
  await user.click(screen.getByRole("button", { name: "צור" }));

  await waitFor(() =>
    expect(screen.getByText("Neve Tzedek Crew")).toBeInTheDocument()
  );

  const postCall = fetchMock.mock.calls.find(
    ([, init]) => init?.method === "POST"
  );
  const [url, init] = postCall!;
  expect(url).toBe("/api/groups");
  expect(JSON.parse(init.body)).toEqual({ name: "Neve Tzedek Crew" });
});

test("shows a sign-in prompt when unauthenticated", async () => {
  fetchMock.mockResolvedValueOnce(
    jsonResponse({ error: "Not signed in." }, 401)
  );
  render(<GroupsList />);

  expect(
    await screen.findByText("התחבר כדי לראות את הקבוצות שלך.")
  ).toBeInTheDocument();
});

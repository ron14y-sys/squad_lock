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

function group(id: string, name: string) {
  return {
    id,
    name,
    createdAt: "2026-08-01T00:00:00.000Z",
    members: [
      {
        userId: "u1",
        joinedAt: "2026-08-01T00:00:00.000Z",
        user: { name: "Dana", email: "dana@example.com" },
      },
    ],
  };
}

function meeting(overrides: Record<string, unknown> = {}) {
  return {
    id: "meeting-1",
    groupId: "group-1",
    groupName: "Rothschild Regulars",
    status: "waiting_on_you",
    waitingOn: null,
    currentDatetime: "2026-09-15T18:00:00.000Z",
    pinnedWhen: null,
    pinnedVenue: null,
    occasion: null,
    approvedCount: 0,
    totalCount: 2,
    ...overrides,
  };
}

const ONE_GROUP = [group("group-1", "Rothschild Regulars")];

let fetchMock: ReturnType<typeof vi.fn>;

/** Answers by URL, so the order the screen asks in never matters. */
function serve(responses: {
  groups?: () => Response;
  meetings?: () => Response;
}) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === "POST") throw new Error(`Unexpected POST ${url}`);
    if (url === "/api/groups")
      return Promise.resolve(
        (responses.groups ?? (() => jsonResponse(ONE_GROUP)))()
      );
    if (url === "/api/meetings")
      return Promise.resolve(
        (responses.meetings ?? (() => jsonResponse({ meetings: [] })))()
      );
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("lists the signed-in user's groups with a member count", async () => {
  serve({});
  render(<GroupsList />);

  expect(await screen.findByText("Rothschild Regulars")).toBeInTheDocument();
  expect(screen.getByText("1 חברים")).toBeInTheDocument();
});

test("shows an empty state with no groups yet", async () => {
  serve({ groups: () => jsonResponse([]) });
  render(<GroupsList />);

  expect(await screen.findByText("עדיין אין לך קבוצות.")).toBeInTheDocument();
});

test("shows, per group, how many meetings are waiting on the viewer", async () => {
  serve({
    groups: () =>
      jsonResponse([
        group("group-1", "Rothschild Regulars"),
        group("group-2", "Work Crew"),
      ]),
    meetings: () =>
      jsonResponse({
        meetings: [
          meeting({ id: "m1", groupId: "group-1" }),
          meeting({ id: "m2", groupId: "group-1" }),
          // Waiting on someone else — does not count as awaiting the viewer.
          meeting({
            id: "m3",
            groupId: "group-2",
            groupName: "Work Crew",
            status: "waiting_on_others",
            waitingOn: 1,
          }),
        ],
      }),
  });
  render(<GroupsList />);

  expect(await screen.findByText("2 ממתינים לך")).toBeInTheDocument();
  expect(screen.getAllByText(/ממתינים לך/)).toHaveLength(1);
});

test("lists every open meeting across groups in one timeline, each linking to its screen", async () => {
  serve({
    groups: () =>
      jsonResponse([
        group("group-1", "Rothschild Regulars"),
        group("group-2", "Work Crew"),
      ]),
    meetings: () =>
      jsonResponse({
        meetings: [
          meeting({ id: "m1", groupId: "group-1" }),
          meeting({
            id: "m2",
            groupId: "group-2",
            groupName: "Work Crew",
            status: "waiting_on_others",
            waitingOn: 2,
            pinnedVenue: "מסעדת הגמל",
          }),
        ],
      }),
  });
  render(<GroupsList />);

  expect(await screen.findByText("היומן שלך")).toBeInTheDocument();
  expect(screen.getByText("ממתין לעוד 2")).toBeInTheDocument();

  const links = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
  expect(links).toContain("/meetings/m1");
  expect(links).toContain("/meetings/m2");
});

test("shows the conflict banner when any open meeting clashes", async () => {
  serve({
    meetings: () =>
      jsonResponse({ meetings: [meeting({ status: "conflicting" })] }),
  });
  render(<GroupsList />);

  expect(
    await screen.findByText(/יש לך פגישות שמתנגשות באותו ערב/)
  ).toBeInTheDocument();
});

test("shows no banner when nothing clashes", async () => {
  serve({ meetings: () => jsonResponse({ meetings: [meeting()] }) });
  render(<GroupsList />);

  await screen.findByText("היומן שלך");
  expect(
    screen.queryByText(/יש לך פגישות שמתנגשות באותו ערב/)
  ).not.toBeInTheDocument();
});

test("creating a group POSTs the name and reloads the list", async () => {
  const user = userEvent.setup();
  serve({ groups: () => jsonResponse([]) });
  render(<GroupsList />);

  await screen.findByText("עדיין אין לך קבוצות.");

  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === "POST")
      return Promise.resolve(
        jsonResponse({ id: "group-2", name: "Neve Tzedek Crew" }, 201)
      );
    if (url === "/api/groups")
      return Promise.resolve(
        jsonResponse([group("group-2", "Neve Tzedek Crew")])
      );
    return Promise.resolve(jsonResponse({ meetings: [] }));
  });

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
  serve({
    groups: () => jsonResponse({ error: "Not signed in." }, 401),
    meetings: () => jsonResponse({ error: "Not signed in." }, 401),
  });
  render(<GroupsList />);

  expect(
    await screen.findByText("התחבר כדי לראות את הקבוצות שלך.")
  ).toBeInTheDocument();
});

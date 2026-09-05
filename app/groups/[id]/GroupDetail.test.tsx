import { afterEach, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GroupDetail } from "./GroupDetail";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const GROUP = {
  id: "group-1",
  name: "Rothschild Regulars",
  members: [
    {
      userId: "u1",
      joinedAt: "2026-08-01T00:00:00.000Z",
      user: { name: "Dana", email: "dana@example.com" },
    },
  ],
};

const PENDING_INVITATION = {
  id: "inv-1",
  email: "yoav@example.com",
  status: "pending",
  createdAt: "2026-08-01T00:00:00.000Z",
};

function routeFetchMock(
  overrides: Record<string, () => Response> = {}
): ReturnType<typeof vi.fn> {
  return vi.fn((url: string) => {
    if (overrides[url]) return Promise.resolve(overrides[url]());
    if (url === "/api/groups") return Promise.resolve(jsonResponse([GROUP]));
    if (url === "/api/groups/group-1/invitations")
      return Promise.resolve(jsonResponse([]));
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("shows the group's name, members, and pending invitations", async () => {
  const fetchMock = routeFetchMock({
    "/api/groups/group-1/invitations": () => jsonResponse([PENDING_INVITATION]),
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<GroupDetail groupId="group-1" />);

  expect(await screen.findByText("Rothschild Regulars")).toBeInTheDocument();
  expect(screen.getByText("Dana")).toBeInTheDocument();
  expect(screen.getByText("dana@example.com")).toBeInTheDocument();
  expect(screen.getByText("ממתינים לאישור (1)")).toBeInTheDocument();
  expect(screen.getByText("yoav@example.com")).toBeInTheDocument();
});

test("inviting someone POSTs the email and shows a confirmation", async () => {
  const user = userEvent.setup();
  const fetchMock = routeFetchMock();
  vi.stubGlobal("fetch", fetchMock);

  render(<GroupDetail groupId="group-1" />);
  await screen.findByText("Rothschild Regulars");

  fetchMock.mockImplementationOnce(() =>
    Promise.resolve(
      jsonResponse(
        {
          id: "inv-2",
          groupId: "group-1",
          email: "maya@example.com",
          status: "pending",
        },
        201
      )
    )
  );
  fetchMock.mockImplementationOnce(() =>
    Promise.resolve(jsonResponse([GROUP]))
  );
  fetchMock.mockImplementationOnce(() =>
    Promise.resolve(
      jsonResponse([{ ...PENDING_INVITATION, email: "maya@example.com" }])
    )
  );

  await user.type(
    screen.getByPlaceholderText("כתובת אימייל"),
    "maya@example.com"
  );
  await user.click(screen.getByRole("button", { name: "הזמן" }));

  await waitFor(() =>
    expect(screen.getByText("ההזמנה נשלחה.")).toBeInTheDocument()
  );

  const postCall = fetchMock.mock.calls.find(
    ([, init]) => init?.method === "POST"
  );
  const [url, init] = postCall!;
  expect(url).toBe("/api/groups/group-1/invitations");
  expect(JSON.parse(init.body)).toEqual({ email: "maya@example.com" });
});

test("shows a friendly message when someone is already a member", async () => {
  const user = userEvent.setup();
  const fetchMock = routeFetchMock();
  vi.stubGlobal("fetch", fetchMock);

  render(<GroupDetail groupId="group-1" />);
  await screen.findByText("Rothschild Regulars");

  fetchMock.mockImplementationOnce(() =>
    Promise.resolve(
      jsonResponse({ error: "This person is already a member." }, 409)
    )
  );

  await user.type(
    screen.getByPlaceholderText("כתובת אימייל"),
    "dana@example.com"
  );
  await user.click(screen.getByRole("button", { name: "הזמן" }));

  expect(
    await screen.findByText("האדם הזה כבר חבר בקבוצה.")
  ).toBeInTheDocument();
});

test("shows a not-found message for a group the user isn't in", async () => {
  const fetchMock = routeFetchMock({
    "/api/groups/group-1/invitations": () =>
      jsonResponse({ error: "Group not found." }, 404),
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<GroupDetail groupId="group-1" />);

  expect(
    await screen.findByText("הקבוצה הזו לא נמצאה, או שאתה לא חבר בה.")
  ).toBeInTheDocument();
});

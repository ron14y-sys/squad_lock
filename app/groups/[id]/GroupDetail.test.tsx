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

test("shows a friendly message when the group is full (#174)", async () => {
  const user = userEvent.setup();
  const fetchMock = routeFetchMock();
  vi.stubGlobal("fetch", fetchMock);

  render(<GroupDetail groupId="group-1" />);
  await screen.findByText("Rothschild Regulars");

  fetchMock.mockImplementationOnce(() =>
    Promise.resolve(
      jsonResponse(
        {
          error: "Group group-1 already has 6 members or pending invitations.",
        },
        409
      )
    )
  );

  await user.type(
    screen.getByPlaceholderText("כתובת אימייל"),
    "dana@example.com"
  );
  await user.click(screen.getByRole("button", { name: "הזמן" }));

  expect(
    await screen.findByText(
      "הקבוצה מלאה (מקסימום 6 חברים, כולל הזמנות ממתינות)."
    )
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

test.each([
  ["That is your own address.", "זו הכתובת שלך. אי אפשר להזמין את עצמך."],
  [
    "This address cannot receive email.",
    "לכתובת הזו אי אפשר לשלוח מייל. כדאי לבדוק שאין טעות הקלדה.",
  ],
])("says why an invitation was refused: %s", async (error, shown) => {
  const user = userEvent.setup();
  const fetchMock = routeFetchMock();
  vi.stubGlobal("fetch", fetchMock);

  render(<GroupDetail groupId="group-1" />);
  await screen.findByText("Rothschild Regulars");

  fetchMock.mockImplementationOnce(() =>
    Promise.resolve(jsonResponse({ error }, 409))
  );

  await user.type(
    screen.getByPlaceholderText("כתובת אימייל"),
    "dana@example.com"
  );
  await user.click(screen.getByRole("button", { name: "הזמן" }));

  expect(await screen.findByText(shown)).toBeInTheDocument();
});

test("cancelling a pending invitation DELETEs it and drops it from the list", async () => {
  const user = userEvent.setup();
  let invitations = [PENDING_INVITATION];
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === "DELETE") {
      invitations = [];
      return Promise.resolve({ ok: true, status: 204 } as Response);
    }
    if (url === "/api/groups") return Promise.resolve(jsonResponse([GROUP]));
    if (url === "/api/groups/group-1/invitations")
      return Promise.resolve(jsonResponse(invitations));
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<GroupDetail groupId="group-1" />);
  await user.click(
    await screen.findByRole("button", {
      name: "בטל את ההזמנה ל-yoav@example.com",
    })
  );

  expect(
    await screen.findByText("ההזמנה ל-yoav@example.com בוטלה.")
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.queryByText("ממתינים לאישור (1)")).not.toBeInTheDocument()
  );
  const deleteCall = fetchMock.mock.calls.find(
    ([, init]) => init?.method === "DELETE"
  );
  expect(deleteCall![0]).toBe("/api/groups/group-1/invitations/inv-1");
});

test("says so when the invitation was accepted before it could be cancelled", async () => {
  const user = userEvent.setup();
  const fetchMock = routeFetchMock({
    "/api/groups/group-1/invitations": () => jsonResponse([PENDING_INVITATION]),
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<GroupDetail groupId="group-1" />);
  const button = await screen.findByRole("button", {
    name: "בטל את ההזמנה ל-yoav@example.com",
  });
  fetchMock.mockImplementationOnce(() =>
    Promise.resolve(
      jsonResponse({ error: "This invitation has already been accepted." }, 409)
    )
  );
  await user.click(button);

  expect(
    await screen.findByText("yoav@example.com כבר הצטרף/ה לקבוצה.")
  ).toBeInTheDocument();
});

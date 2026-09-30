import { afterEach, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MeetingDetail } from "./MeetingDetail";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function detail(overrides: Record<string, unknown> = {}) {
  return {
    id: "meeting-1",
    groupId: "group-1",
    status: "waiting_on_you",
    viewerId: "u2",
    remainingCycles: 3,
    isStuck: false,
    isInitiator: false,
    conflicts: [],
    missingHome: [],
    initiatorName: "אלדד",
    pinnedVenue: null,
    occasion: null,
    proposal: {
      venueName: "בית קפה נורדאו",
      venueAddress: "נורדאו 14",
      venueType: null,
      venueSummary: null,
      start: "2026-09-15T18:00:00.000Z",
      end: "2026-09-15T20:00:00.000Z",
      justification: "מקום שקט, קרוב לעבודה שלך.",
      unverified: [],
      alsoConsidered: [],
    },
    participants: [
      {
        userId: "u1",
        name: "רון",
        status: "approved",
        respondedAt: "2026-09-14T12:00:00.000Z",
      },
      { userId: "u2", name: "דני", status: "pending", respondedAt: null },
    ],
    approvedCount: 1,
    totalCount: 2,
    timeline: [
      { kind: "initiated", at: "2026-09-13T10:00:00.000Z", by: "אלדד" },
    ],
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("says what the place is, in Google's words, under its name", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        jsonResponse(
          detail({
            proposal: {
              ...detail().proposal,
              venueType: "בית קפה",
              venueSummary: "קפה קלוי במקום ומאפים",
            },
          })
        )
      )
    )
  );

  render(<MeetingDetail meetingId="meeting-1" />);

  expect(
    await screen.findByText("בית קפה · קפה קלוי במקום ומאפים")
  ).toBeInTheDocument();
});

test("shows the proposal, and reveals the justification only on request", async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(jsonResponse(detail())))
  );

  render(<MeetingDetail meetingId="meeting-1" />);

  expect(await screen.findByText("בית קפה נורדאו")).toBeInTheDocument();
  expect(
    screen.queryByText("מקום שקט, קרוב לעבודה שלך.")
  ).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "למה זה מתאים לך" }));
  expect(screen.getByText("מקום שקט, קרוב לעבודה שלך.")).toBeInTheDocument();
});

test("two viewers of the same meeting see their own justification, not each other's", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        jsonResponse(
          detail({
            proposal: {
              venueName: "בית קפה נורדאו",
              venueAddress: null,
              start: "2026-09-15T18:00:00.000Z",
              end: "2026-09-15T20:00:00.000Z",
              justification: "עשר דקות הליכה בשבילך.",
              unverified: [],
              alsoConsidered: [],
            },
          })
        )
      )
    )
  );
  const user = userEvent.setup();

  render(<MeetingDetail meetingId="meeting-1" />);
  await user.click(
    await screen.findByRole("button", { name: "למה זה מתאים לך" })
  );

  // Each render only ever has the one justification the API sent for that
  // viewer — there is no field on the wire for anyone else's.
  expect(screen.getByText("עשר דקות הליכה בשבילך.")).toBeInTheDocument();
  expect(
    screen.queryByText("מקום שקט, קרוב לעבודה שלך.")
  ).not.toBeInTheDocument();
});

test("never shows a comparative cost line, even when the API sends none to compare", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(jsonResponse(detail())))
  );

  render(<MeetingDetail meetingId="meeting-1" />);
  await screen.findByText("בית קפה נורדאו");

  // tradeoffs are never part of the DTO at all — nothing to assert against
  // by name, so this just confirms the page renders cleanly without one.
  expect(screen.queryByText(/יותר גרוע|לעומת/)).not.toBeInTheDocument();
});

test("a dropped-out participant stays listed", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        jsonResponse(
          detail({
            participants: [
              {
                userId: "u1",
                name: "רון",
                status: "approved",
                respondedAt: "2026-09-14T12:00:00.000Z",
              },
              {
                userId: "u2",
                name: "דני",
                status: "cant_make_it",
                respondedAt: "2026-09-14T13:00:00.000Z",
              },
            ],
          })
        )
      )
    )
  );

  render(<MeetingDetail meetingId="meeting-1" />);

  expect(await screen.findByText("דני")).toBeInTheDocument();
  expect(screen.getByText(/לא יכול להגיע/)).toBeInTheDocument();
});

test("shows the timeline in order, including why a re-weighing happened", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        jsonResponse(
          detail({
            timeline: [
              { kind: "initiated", at: "2026-09-13T10:00:00.000Z", by: "אלדד" },
              {
                kind: "response",
                at: "2026-09-13T11:00:00.000Z",
                by: "דני",
                status: "doesnt_suit",
                reasonText: "רועש מדי",
              },
              {
                kind: "proposed",
                at: "2026-09-13T12:00:00.000Z",
                cycleNumber: 2,
                venueName: "מסעדת הגמל",
                reweighedBecause: "רועש מדי",
              },
            ],
          })
        )
      )
    )
  );

  render(<MeetingDetail meetingId="meeting-1" />);

  expect(await screen.findByText("אלדד יזם/ה את הפגישה")).toBeInTheDocument();
  expect(screen.getByText('דני: לא מתאים לו — "רועש מדי"')).toBeInTheDocument();
  expect(
    screen.getByText("שוקלל מחדש ← מסעדת הגמל (רועש מדי)")
  ).toBeInTheDocument();
});

test("shows a placeholder when no proposal exists yet", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(jsonResponse(detail({ proposal: null }))))
  );

  render(<MeetingDetail meetingId="meeting-1" />);

  expect(
    await screen.findByText("עדיין אין הצעה — הסוכן בוחן אפשרויות.")
  ).toBeInTheDocument();
});

test("shows a sign-in prompt when unauthenticated", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(jsonResponse({ error: "Not signed in." }, 401)))
  );

  render(<MeetingDetail meetingId="meeting-1" />);

  expect(await screen.findByText("התחבר כדי לראות פגישה.")).toBeInTheDocument();
});

test("shows a not-found message for a meeting the user isn't part of", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(jsonResponse({ error: "Meeting not found." }, 404))
    )
  );

  render(<MeetingDetail meetingId="meeting-1" />);

  expect(
    await screen.findByText("הפגישה הזו לא נמצאה, או שאתה לא משתתף בה.")
  ).toBeInTheDocument();
});

test("puts the conflict warning above the approve button when the viewer has a clash", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        jsonResponse(
          detail({
            status: "conflicting",
            conflicts: [
              {
                meetingId: "meeting-2",
                groupName: "סועדים בשקט",
                venueName: null,
                start: null,
              },
            ],
          })
        )
      )
    )
  );

  render(<MeetingDetail meetingId="meeting-1" />);

  const warning = await screen.findByText(/יש לך פגישה נוספת באותו ערב/);
  const approve = screen.getByRole("button", { name: "מאשר/ת" });
  // DOCUMENT_POSITION_FOLLOWING: the approve button comes after the warning.
  expect(
    warning.compareDocumentPosition(approve) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy();
});

test("shows no conflict warning when there is no clash", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(jsonResponse(detail())))
  );

  render(<MeetingDetail meetingId="meeting-1" />);
  await screen.findByText("בית קפה נורדאו");

  expect(
    screen.queryByText(/יש לך פגישה נוספת באותו ערב/)
  ).not.toBeInTheDocument();
});

test("a stuck meeting explains itself, lists what was said, and relabels its best option", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        jsonResponse(
          detail({
            status: "stuck",
            isStuck: true,
            timeline: [
              { kind: "initiated", at: "2026-09-13T10:00:00.000Z", by: "אלדד" },
              {
                kind: "response",
                at: "2026-09-13T11:00:00.000Z",
                by: "דני",
                status: "doesnt_suit",
                reasonText: "רועש מדי",
              },
            ],
          })
        )
      )
    )
  );

  render(<MeetingDetail meetingId="meeting-1" />);

  expect(await screen.findByText("הפגישה הזו תקועה")).toBeInTheDocument();
  expect(screen.getByText("ההצעה הטובה ביותר שמצאנו")).toBeInTheDocument();
  expect(screen.getByText(/דני: "רועש מדי"/)).toBeInTheDocument();
});

test("a meeting that is not stuck shows no stuck panel", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(jsonResponse(detail())))
  );

  render(<MeetingDetail meetingId="meeting-1" />);
  await screen.findByText("בית קפה נורדאו");

  expect(screen.queryByText("הפגישה הזו תקועה")).not.toBeInTheDocument();
});

test("says who has no home area when that is why there is no proposal (#132)", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        jsonResponse(
          detail({
            proposal: null,
            missingHome: [{ userId: "u1", name: "רון" }],
          })
        )
      )
    )
  );

  render(<MeetingDetail meetingId="meeting-1" />);

  expect(
    await screen.findByText(/רון עוד לא הגדיר.ה שכונת מגורים/)
  ).toBeInTheDocument();
  // The viewer (u2) is not the one missing, so no prompt to fix their own.
  expect(
    screen.queryByRole("link", { name: "הגדר עכשיו" })
  ).not.toBeInTheDocument();
});

test("tells the viewer where to fix it when they are the one missing", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        jsonResponse(
          detail({
            proposal: null,
            missingHome: [{ userId: "u2", name: "דני" }],
          })
        )
      )
    )
  );

  render(<MeetingDetail meetingId="meeting-1" />);

  expect(
    await screen.findByRole("link", { name: "הגדר עכשיו" })
  ).toHaveAttribute("href", "/profile/location");
});

test("shows no notice when nobody is missing a home area", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(jsonResponse(detail({ proposal: null }))))
  );

  render(<MeetingDetail meetingId="meeting-1" />);

  await screen.findByText("עדיין אין הצעה — הסוכן בוחן אפשרויות.");
  expect(
    screen.queryByText("אי אפשר להכין הצעה עדיין")
  ).not.toBeInTheDocument();
});

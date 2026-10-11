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
    viewerAmendmentIsFree: true,
    isStuck: false,
    isInitiator: false,
    conflicts: [],
    missingHome: [],
    retryInMinutes: null,
    nextRunInMinutes: null,
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
      uncheckedCalendars: [],
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
    runStage: null,
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
              uncheckedCalendars: [],
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

test("a proposal says when what was asked for tonight was not found (#221)", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        jsonResponse(
          detail({
            proposal: {
              ...detail().proposal,
              unverified: [
                { kind: "unmet_request", venueKinds: ["bar"], cuisines: [] },
              ],
            },
          })
        )
      )
    )
  );

  render(<MeetingDetail meetingId="meeting-1" />);

  expect(
    await screen.findByText(
      "לא מצאנו מקום שמתאים לכולם מהסוג שביקשתם (בר), אז הצענו משהו אחר."
    )
  ).toBeInTheDocument();
});

test("a proposal says when the venue that was asked for could not be offered (#212)", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        jsonResponse(
          detail({
            proposal: {
              ...detail().proposal,
              unverified: [
                {
                  kind: "unmet_pinned_venue",
                  venue: "בר הים",
                  reason: "too_far",
                },
              ],
            },
          })
        )
      )
    )
  );

  render(<MeetingDetail meetingId="meeting-1" />);

  expect(
    await screen.findByText(
      "המקום שביקשתם (בר הים) רחוק מדי עבור חלק מהחברים, אז הצענו משהו אחר."
    )
  ).toBeInTheDocument();
});

test("a proposal names whose calendar it was not checked against", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        jsonResponse(
          detail({
            proposal: {
              ...detail().proposal,
              uncheckedCalendars: [{ userId: "u1", name: "רון" }],
            },
          })
        )
      )
    )
  );

  render(<MeetingDetail meetingId="meeting-1" />);

  expect(
    await screen.findByText(
      "הזמן הזה לא נבדק מול היומן של רון, כי הוא עוד לא מחובר."
    )
  ).toBeInTheDocument();
  // The viewer (u2) is not the one missing, so no prompt to connect their own.
  expect(
    screen.queryByRole("link", { name: "חבר יומן" })
  ).not.toBeInTheDocument();
});

test("a proposal tells the viewer their own calendar was not checked, with a way to connect", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        jsonResponse(
          detail({
            proposal: {
              ...detail().proposal,
              uncheckedCalendars: [{ userId: "u2", name: "דני" }],
            },
          })
        )
      )
    )
  );

  render(<MeetingDetail meetingId="meeting-1" />);

  expect(
    await screen.findByText(/לא חיברת יומן, אז הזמן הזה נבדק רק מול השעות/)
  ).toBeInTheDocument();
  // Not /api/auth/signin: that sends a signed-in person to /groups.
  expect(screen.getByRole("link", { name: "חבר יומן" })).toHaveAttribute(
    "href",
    "/api/calendar/connect?callbackUrl=%2Fmeetings%2Fmeeting-1"
  );
  // The viewer's own line only — not "the calendar of דני" as well.
  expect(screen.queryByText(/היומן של דני/)).not.toBeInTheDocument();
});

test("B9 part five: says when the next automatic attempt is, once a service has rate-limited us", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        jsonResponse(detail({ proposal: null, retryInMinutes: 10 }))
      )
    )
  );

  render(<MeetingDetail meetingId="meeting-1" />);

  expect(
    await screen.findByText(/ננסה שוב בעוד כ-10 דקות/)
  ).toBeInTheDocument();
});

test("B9 part five: says 'about a minute' rather than 'about 1 minutes'", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        jsonResponse(detail({ proposal: null, retryInMinutes: 1 }))
      )
    )
  );

  render(<MeetingDetail meetingId="meeting-1" />);

  expect(await screen.findByText(/ננסה שוב בעוד כדקה/)).toBeInTheDocument();
});

test("B9 part five: shows no waiting notice when nothing is blocking", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(jsonResponse(detail({ proposal: null }))))
  );

  render(<MeetingDetail meetingId="meeting-1" />);

  await screen.findByText(/איפה זה עומד/);
  expect(screen.queryByText("ההתאמה מחכה")).not.toBeInTheDocument();
});

test("B9 part five: stays out of the way of the stuck panel", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        jsonResponse(
          detail({
            isStuck: true,
            proposal: null,
            retryInMinutes: 10,
          })
        )
      )
    )
  );

  render(<MeetingDetail meetingId="meeting-1" />);

  await screen.findByText(/איפה זה עומד/);
  expect(screen.queryByText("ההתאמה מחכה")).not.toBeInTheDocument();
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

test("asks again every ~3s while re-weighing, and stops once a proposal is back", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse(detail({ status: "reweighing" })))
    .mockResolvedValueOnce(jsonResponse(detail({ status: "reweighing" })))
    .mockResolvedValue(jsonResponse(detail()));
  vi.stubGlobal("fetch", fetchMock);

  render(<MeetingDetail meetingId="meeting-1" />);
  expect(await screen.findByText("משוקלל מחדש")).toBeInTheDocument();
  // #169: the rejected proposal is off the table — it must not show while
  // a new one is being worked out.
  expect(screen.queryByText("בית קפה נורדאו")).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(1);

  await vi.advanceTimersByTimeAsync(3000);
  expect(fetchMock).toHaveBeenCalledTimes(2);

  await vi.advanceTimersByTimeAsync(3000);
  expect(fetchMock).toHaveBeenCalledTimes(3);

  expect(screen.getByText("משוקלל מחדש")).toBeInTheDocument();

  // The third answer is `waiting_on_you` — the new proposal is out, and
  // nothing is asked after the page shows it.
  await vi.waitFor(() =>
    expect(screen.queryByText("משוקלל מחדש")).not.toBeInTheDocument()
  );
  expect(screen.getByText("בית קפה נורדאו")).toBeInTheDocument();
  const settled = fetchMock.mock.calls.length;
  await vi.advanceTimersByTimeAsync(9000);
  expect(fetchMock).toHaveBeenCalledTimes(settled);
  vi.useRealTimers();
});

test("names the stage while a run works through it (#169, #155)", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        jsonResponse(detail({ status: "reweighing", runStage: "places" }))
      )
    )
  );

  render(<MeetingDetail meetingId="meeting-1" />);

  expect(await screen.findByText("מחפשים מקומות")).toBeInTheDocument();
});

test("a stuck meeting shows the stuck panel, not the re-weighing spinner", async () => {
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
            ],
          })
        )
      )
    )
  );

  render(<MeetingDetail meetingId="meeting-1" />);

  expect(await screen.findByText("הפגישה הזו תקועה")).toBeInTheDocument();
  expect(screen.queryByText("מחפשים הצעה חדשה")).not.toBeInTheDocument();
});

test("a failed poll leaves the page on screen", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse(detail({ status: "reweighing" })))
    .mockResolvedValue(jsonResponse({}, 500));
  vi.stubGlobal("fetch", fetchMock);

  render(<MeetingDetail meetingId="meeting-1" />);
  expect(await screen.findByText("מחפשים הצעה חדשה")).toBeInTheDocument();

  await vi.advanceTimersByTimeAsync(3000);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(screen.getByText("מחפשים הצעה חדשה")).toBeInTheDocument();
  vi.useRealTimers();
});

test("a meeting's opening search is not called a re-weighing, nor a new proposal", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        jsonResponse(detail({ status: "reweighing", proposal: null }))
      )
    )
  );

  render(<MeetingDetail meetingId="meeting-1" />);

  // The status sticker and the block heading both say it.
  expect(await screen.findAllByText("מחפשים הצעה")).toHaveLength(2);
  expect(screen.queryByText("משוקלל מחדש")).not.toBeInTheDocument();
  expect(screen.queryByText("מחפשים הצעה חדשה")).not.toBeInTheDocument();
});

test("the meeting's topic is the page heading", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(jsonResponse(detail({ occasion: "יום הולדת לנועה" })))
    )
  );

  render(<MeetingDetail meetingId="meeting-1" />);

  expect(
    await screen.findByRole("heading", { level: 1, name: "יום הולדת לנועה" })
  ).toBeInTheDocument();
});

test("no topic, no empty heading", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(jsonResponse(detail())))
  );

  render(<MeetingDetail meetingId="meeting-1" />);

  await screen.findByText("בית קפה נורדאו");
  expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
});

test("after a rejection, says when the next proposal will come (#215)", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        jsonResponse(detail({ status: "reweighing", nextRunInMinutes: 3 }))
      )
    )
  );

  render(<MeetingDetail meetingId="meeting-1" />);

  expect(
    await screen.findByText("ההצעה הבאה תהיה מוכנה בעוד כ-3 דקות.")
  ).toBeInTheDocument();
});

test("says a minute, not '1 minutes', when it is that close (#215)", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        jsonResponse(detail({ status: "reweighing", nextRunInMinutes: 1 }))
      )
    )
  );

  render(<MeetingDetail meetingId="meeting-1" />);

  expect(
    await screen.findByText("ההצעה הבאה תהיה מוכנה בעוד כדקה.")
  ).toBeInTheDocument();
});

test("names the stage rather than a countdown once the run has started (#215)", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        jsonResponse(
          detail({
            status: "reweighing",
            runStage: "places",
            nextRunInMinutes: 3,
          })
        )
      )
    )
  );

  render(<MeetingDetail meetingId="meeting-1" />);

  expect(await screen.findByText("מחפשים מקומות")).toBeInTheDocument();
  expect(screen.queryByText(/ההצעה הבאה תהיה מוכנה/)).not.toBeInTheDocument();
});

test("says nothing about a wait once it is over and the run only needs starting (#215)", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        jsonResponse(detail({ status: "reweighing", nextRunInMinutes: null }))
      )
    )
  );

  render(<MeetingDetail meetingId="meeting-1" />);

  expect(await screen.findByText("מחפשים הצעה חדשה…")).toBeInTheDocument();
});

test("the opening search names no wait, since nothing guarantees its result (#215)", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        jsonResponse(
          detail({
            status: "reweighing",
            proposal: null,
            nextRunInMinutes: 2,
          })
        )
      )
    )
  );

  render(<MeetingDetail meetingId="meeting-1" />);

  expect(await screen.findByText("מחפשים הצעה…")).toBeInTheDocument();
  expect(screen.queryByText(/ההצעה הבאה תהיה מוכנה/)).not.toBeInTheDocument();
});

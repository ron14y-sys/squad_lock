import { afterEach, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResponseControls } from "./ResponseControls";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("approving posts kind: approve and reports back", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({})));
  vi.stubGlobal("fetch", fetchMock);
  const onResponded = vi.fn();

  render(
    <ResponseControls
      meetingId="meeting-1"
      myStatus="pending"
      remainingCycles={3}
      amendmentIsFree={true}
      disabled={false}
      onResponded={onResponded}
    />
  );

  await user.click(screen.getByRole("button", { name: "מאשר/ת" }));

  const [url, init] = fetchMock.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  expect(url).toBe("/api/meetings/meeting-1/respond");
  expect(JSON.parse(init.body as string)).toEqual({ kind: "approve" });
  expect(onResponded).toHaveBeenCalledOnce();
});

test("can't-make-it posts kind: cant_make_it", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({})));
  vi.stubGlobal("fetch", fetchMock);

  render(
    <ResponseControls
      meetingId="meeting-1"
      myStatus="pending"
      remainingCycles={3}
      amendmentIsFree={true}
      disabled={false}
      onResponded={vi.fn()}
    />
  );

  await user.click(screen.getByRole("button", { name: "לא יכול/ה להגיע" }));

  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(init.body as string)).toEqual({ kind: "cant_make_it" });
});

test("something doesn't work shows the remaining cycle count and requires a reason", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({})));
  vi.stubGlobal("fetch", fetchMock);

  render(
    <ResponseControls
      meetingId="meeting-1"
      myStatus="pending"
      remainingCycles={2}
      amendmentIsFree={true}
      disabled={false}
      onResponded={vi.fn()}
    />
  );

  await user.click(
    screen.getByRole("button", { name: "משהו כאן לא מתאים לי" })
  );
  expect(screen.getByText(/נותרו 2 ניסיונות/)).toBeInTheDocument();

  const sendButton = screen.getByRole("button", { name: "שלח" });
  expect(sendButton).toBeDisabled();

  // The box for one's own words sits behind "other".
  expect(screen.queryByPlaceholderText("מה לא מתאים?")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "אחר" }));
  await user.type(screen.getByPlaceholderText("מה לא מתאים?"), "רועש מדי");
  expect(sendButton).not.toBeDisabled();
  await user.click(sendButton);

  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(init.body as string)).toEqual({
    kind: "doesnt_suit",
    reasonText: "רועש מדי",
  });
});

function openRejection(
  fetchMock = vi.fn(() => Promise.resolve(jsonResponse({})))
) {
  vi.stubGlobal("fetch", fetchMock);
  render(
    <ResponseControls
      meetingId="meeting-1"
      myStatus="pending"
      remainingCycles={3}
      amendmentIsFree={true}
      disabled={false}
      onResponded={vi.fn()}
    />
  );
  return fetchMock;
}

function sentBody(fetchMock: ReturnType<typeof vi.fn>) {
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  return JSON.parse(init.body as string);
}

test("a ticked reason with nothing to say yet does not enable sending", async () => {
  const user = userEvent.setup();
  openRejection();
  await user.click(
    screen.getByRole("button", { name: "משהו כאן לא מתאים לי" })
  );
  const send = screen.getByRole("button", { name: "שלח" });
  expect(send).toBeDisabled();

  // A style or a cuisine ticked but none picked, an hour ticked but not set:
  // each is half a reason, so nothing can be sent yet.
  await user.click(screen.getByRole("button", { name: "סגנון המקום" }));
  await user.click(screen.getByRole("button", { name: "סוג האוכל" }));
  await user.click(screen.getByRole("button", { name: "השעה לא מתאימה" }));
  await user.click(screen.getByRole("button", { name: "אחר" }));
  expect(send).toBeDisabled();

  await user.click(screen.getByRole("button", { name: "בר" }));
  expect(send).not.toBeDisabled();
});

test("one tick is a whole reason for 'too far' and 'too expensive'", async () => {
  const user = userEvent.setup();
  const fetchMock = openRejection();
  await user.click(
    screen.getByRole("button", { name: "משהו כאן לא מתאים לי" })
  );
  await user.click(screen.getByRole("button", { name: "רחוק לי מדי" }));
  await user.click(screen.getByRole("button", { name: "יקר לי מדי" }));
  await user.click(screen.getByRole("button", { name: "שלח" }));

  expect(sentBody(fetchMock)).toEqual({
    kind: "doesnt_suit",
    reasons: { tooFar: true, tooExpensive: true },
  });
});

test("styles, cuisines, an hour and own words travel together", async () => {
  const user = userEvent.setup();
  const fetchMock = openRejection();
  await user.click(
    screen.getByRole("button", { name: "משהו כאן לא מתאים לי" })
  );

  await user.click(screen.getByRole("button", { name: "סגנון המקום" }));
  await user.click(screen.getByRole("button", { name: "בר" }));
  await user.click(screen.getByRole("button", { name: "בית קפה" }));

  await user.click(screen.getByRole("button", { name: "סוג האוכל" }));
  await user.click(screen.getByRole("button", { name: "פיצה" }));

  await user.click(screen.getByRole("button", { name: "השעה לא מתאימה" }));
  await user.type(screen.getByLabelText("שעה מתאימה"), "21:30");

  await user.click(screen.getByRole("button", { name: "אחר" }));
  await user.type(screen.getByPlaceholderText("מה לא מתאים?"), "  רועש  ");

  await user.click(screen.getByRole("button", { name: "שלח" }));

  expect(sentBody(fetchMock)).toEqual({
    kind: "doesnt_suit",
    reasons: {
      venueKinds: ["bar", "cafe"],
      cuisines: ["pizza"],
      suitableStart: "21:30",
    },
    reasonText: "רועש",
  });
});

test("un-ticking a reason takes it out of the request", async () => {
  const user = userEvent.setup();
  const fetchMock = openRejection();
  await user.click(
    screen.getByRole("button", { name: "משהו כאן לא מתאים לי" })
  );

  await user.click(screen.getByRole("button", { name: "סוג האוכל" }));
  await user.click(screen.getByRole("button", { name: "פיצה" }));
  await user.click(screen.getByRole("button", { name: "סוג האוכל" }));
  await user.click(screen.getByRole("button", { name: "יקר לי מדי" }));
  await user.click(screen.getByRole("button", { name: "שלח" }));

  expect(sentBody(fetchMock)).toEqual({
    kind: "doesnt_suit",
    reasons: { tooExpensive: true },
  });
});

test("not every style of place can be ruled out", async () => {
  const user = userEvent.setup();
  openRejection();
  await user.click(
    screen.getByRole("button", { name: "משהו כאן לא מתאים לי" })
  );
  await user.click(screen.getByRole("button", { name: "סגנון המקום" }));

  await user.click(screen.getByRole("button", { name: "בר" }));
  await user.click(screen.getByRole("button", { name: "בית קפה" }));

  // Two of three are out; the last one stays available.
  expect(screen.getByRole("button", { name: "מסעדה" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "בר" })).not.toBeDisabled();

  await user.click(screen.getByRole("button", { name: "בר" }));
  expect(screen.getByRole("button", { name: "מסעדה" })).not.toBeDisabled();
});

test("not every cuisine can be ruled out", async () => {
  const user = userEvent.setup();
  openRejection();
  await user.click(
    screen.getByRole("button", { name: "משהו כאן לא מתאים לי" })
  );
  await user.click(screen.getByRole("button", { name: "סוג האוכל" }));

  const labels = [
    "איטלקי",
    "פיצה",
    "המבורגר",
    "בשרים / גריל",
    "אסייתי",
    "סושי / יפני",
    "ים-תיכוני / מזרחי",
    "דגים ופירות ים",
    "מקסיקני",
  ];
  for (const label of labels) {
    await user.click(screen.getByRole("button", { name: label }));
  }

  // Nine of ten are out; the tenth can no longer be picked.
  expect(screen.getByRole("button", { name: "הודי" })).toBeDisabled();
});

test("a failed rejection keeps the form open and shows the error", async () => {
  const user = userEvent.setup();
  openRejection(
    vi.fn(() =>
      Promise.resolve(
        jsonResponse({ error: "This meeting is no longer open." }, 409)
      )
    )
  );
  await user.click(
    screen.getByRole("button", { name: "משהו כאן לא מתאים לי" })
  );
  await user.click(screen.getByRole("button", { name: "רחוק לי מדי" }));
  await user.click(screen.getByRole("button", { name: "שלח" }));

  expect(
    await screen.findByText("הפגישה הזו כבר לא פתוחה לתגובות.")
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "שלח" })).toBeInTheDocument();
});

test("an amendment sends only the fields that were filled in, meeting-scoped", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({})));
  vi.stubGlobal("fetch", fetchMock);

  render(
    <ResponseControls
      meetingId="meeting-1"
      myStatus="pending"
      remainingCycles={3}
      amendmentIsFree={true}
      disabled={false}
      onResponded={vi.fn()}
    />
  );

  await user.click(screen.getByRole("button", { name: "המצב שלי הערב שונה" }));

  const submitButton = screen.getByRole("button", { name: "עדכן" });
  expect(submitButton).toBeDisabled();

  await user.selectOptions(
    screen.getByRole("combobox", { name: "אין לי הערב (אופציונלי)" }),
    "car"
  );
  expect(submitButton).not.toBeDisabled();
  await user.click(submitButton);

  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(init.body as string)).toEqual({
    kind: "amendment",
    mobilityWindows: [
      {
        mode: "car",
        available: false,
        window: { weekdays: [], from: "00:00", to: "23:59" },
      },
    ],
  });
});

test("an amendment resolves the picked neighbourhood to real coordinates (#222)", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({})));
  vi.stubGlobal("fetch", fetchMock);

  render(
    <ResponseControls
      meetingId="meeting-1"
      myStatus="pending"
      remainingCycles={3}
      amendmentIsFree={true}
      disabled={false}
      onResponded={vi.fn()}
    />
  );

  await user.click(screen.getByRole("button", { name: "המצב שלי הערב שונה" }));
  await user.selectOptions(
    screen.getByRole("combobox", { name: "מגיע/ה מ... (אופציונלי)" }),
    "ta-florentin"
  );
  await user.click(screen.getByRole("button", { name: "עדכן" }));

  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(init.body as string)).toEqual({
    kind: "amendment",
    origin: { lat: 32.0563, lng: 34.769 },
    originLabel: "פלורנטין, תל אביב",
  });
});

test("an amendment sends tonight's chosen travel tolerance (#222)", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({})));
  vi.stubGlobal("fetch", fetchMock);

  render(
    <ResponseControls
      meetingId="meeting-1"
      myStatus="pending"
      remainingCycles={3}
      amendmentIsFree={true}
      disabled={false}
      onResponded={vi.fn()}
    />
  );

  await user.click(screen.getByRole("button", { name: "המצב שלי הערב שונה" }));
  const chip = screen.getByRole("button", { name: "בשכונה" });
  await user.click(chip);
  expect(chip).toHaveAttribute("aria-pressed", "true");
  await user.click(screen.getByRole("button", { name: "עדכן" }));

  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(init.body as string)).toEqual({
    kind: "amendment",
    toleranceKm: 3,
  });
});

test("clicking a selected tolerance chip again deselects it", async () => {
  const user = userEvent.setup();
  render(
    <ResponseControls
      meetingId="meeting-1"
      myStatus="pending"
      remainingCycles={3}
      amendmentIsFree={true}
      disabled={false}
      onResponded={vi.fn()}
    />
  );

  await user.click(screen.getByRole("button", { name: "המצב שלי הערב שונה" }));
  const chip = screen.getByRole("button", { name: "ברגל" });
  await user.click(chip);
  expect(chip).toHaveAttribute("aria-pressed", "true");
  await user.click(chip);
  expect(chip).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("button", { name: "עדכן" })).toBeDisabled();
});

test("an amendment sends a not-before and not-after window for tonight (#223)", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({})));
  vi.stubGlobal("fetch", fetchMock);

  render(
    <ResponseControls
      meetingId="meeting-1"
      myStatus="pending"
      remainingCycles={3}
      amendmentIsFree={true}
      disabled={false}
      onResponded={vi.fn()}
    />
  );

  await user.click(screen.getByRole("button", { name: "המצב שלי הערב שונה" }));
  await user.type(screen.getByLabelText("לא לפני"), "18:00");
  await user.type(screen.getByLabelText("לא אחרי"), "21:00");
  await user.click(screen.getByRole("button", { name: "עדכן" }));

  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(init.body as string)).toEqual({
    kind: "amendment",
    earliestStart: "18:00",
    latestStart: "21:00",
  });
});

test("only one of not-before or not-after can be set on its own", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({})));
  vi.stubGlobal("fetch", fetchMock);

  render(
    <ResponseControls
      meetingId="meeting-1"
      myStatus="pending"
      remainingCycles={3}
      amendmentIsFree={true}
      disabled={false}
      onResponded={vi.fn()}
    />
  );

  await user.click(screen.getByRole("button", { name: "המצב שלי הערב שונה" }));
  await user.type(screen.getByLabelText("לא אחרי"), "20:00");
  await user.click(screen.getByRole("button", { name: "עדכן" }));

  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(init.body as string)).toEqual({
    kind: "amendment",
    latestStart: "20:00",
  });
});

test("the amendment panel's copy follows whether this would be the viewer's free one (B11)", async () => {
  const user = userEvent.setup();

  const { unmount } = render(
    <ResponseControls
      meetingId="meeting-1"
      myStatus="pending"
      remainingCycles={3}
      amendmentIsFree={true}
      disabled={false}
      onResponded={vi.fn()}
    />
  );
  await user.click(screen.getByRole("button", { name: "המצב שלי הערב שונה" }));
  expect(screen.getByText(/זה התיקון החינמי שלך/)).toBeInTheDocument();
  unmount();

  render(
    <ResponseControls
      meetingId="meeting-1"
      myStatus="pending"
      remainingCycles={2}
      amendmentIsFree={false}
      disabled={false}
      onResponded={vi.fn()}
    />
  );
  await user.click(screen.getByRole("button", { name: "המצב שלי הערב שונה" }));
  expect(screen.getByText(/התיקון החינמי כבר נוצל/)).toBeInTheDocument();
  expect(screen.getByText(/נשארו 2 ניסיונות/)).toBeInTheDocument();
});

test("shows a friendly message when the meeting is no longer open", async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        jsonResponse({ error: "This meeting is no longer open." }, 409)
      )
    )
  );

  render(
    <ResponseControls
      meetingId="meeting-1"
      myStatus="pending"
      remainingCycles={3}
      amendmentIsFree={true}
      disabled={false}
      onResponded={vi.fn()}
    />
  );

  await user.click(screen.getByRole("button", { name: "מאשר/ת" }));

  expect(
    await screen.findByText("הפגישה הזו כבר לא פתוחה לתגובות.")
  ).toBeInTheDocument();
});

test("disables every control when the meeting is closed", () => {
  render(
    <ResponseControls
      meetingId="meeting-1"
      myStatus="approved"
      remainingCycles={3}
      amendmentIsFree={true}
      disabled
      onResponded={vi.fn()}
    />
  );

  expect(screen.getByRole("button", { name: "מאשר/ת" })).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "לא יכול/ה להגיע" })
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "משהו כאן לא מתאים לי" })
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "המצב שלי הערב שונה" })
  ).toBeDisabled();
});

import { expect, it } from "vitest";
import { meetingDateLabel } from "./meeting-when";

it("formats a pinned date", () => {
  expect(
    meetingDateLabel({
      currentDatetime: null,
      pinnedWhen: { date: "2026-09-15" },
    })
  ).toBe("15/09");
});

it("prefers the proposal's own datetime over the pinned date", () => {
  expect(
    meetingDateLabel({
      currentDatetime: "2026-09-16T18:00:00.000Z",
      pinnedWhen: { date: "2026-09-15" },
    })
  ).not.toBe("15/09");
});

it("falls back when nothing is pinned", () => {
  expect(meetingDateLabel({ currentDatetime: null, pinnedWhen: null })).toBe(
    "טרם נקבע"
  );
});

it("falls back for a part of day with no date (#168)", () => {
  expect(meetingDateLabel({ currentDatetime: null, pinnedWhen: {} })).toBe(
    "טרם נקבע"
  );
});

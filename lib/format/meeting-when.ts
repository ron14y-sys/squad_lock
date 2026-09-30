// How a meeting's date and time are shown — shared by the group feed and the
// all-groups timeline, so the two can never disagree about the same meeting.

import { APP_TIME_ZONE } from "@/lib/types/primitives";

const DATE_FMT = new Intl.DateTimeFormat("he-IL", {
  timeZone: APP_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
});

const TIME_FMT = new Intl.DateTimeFormat("he-IL", {
  timeZone: APP_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** `"2026-09-15"` → `"15/09"`. Already local wall clock, so no zone conversion belongs here. */
function formatLocalDate(date: string): string {
  const [, month, day] = date.split("-");
  return `${day}/${month}`;
}

export function meetingDateLabel(meeting: {
  currentDatetime: string | null;
  // #168: a part of day (pinnedWhen.kind "part_of_day"/"date_and_part_of_day")
  // has no `date` at all in one of those two cases — the index signature is
  // what lets that shape (no properties in common with `{ date?: string }`)
  // still satisfy this parameter.
  pinnedWhen: ({ date?: string } & Record<string, unknown>) | null;
}): string {
  if (meeting.currentDatetime)
    return DATE_FMT.format(new Date(meeting.currentDatetime));
  // #168: a part of day with no date (pinnedWhen.date absent) has nothing
  // to show here — same fallback as no pin at all.
  if (meeting.pinnedWhen?.date) return formatLocalDate(meeting.pinnedWhen.date);
  return "טרם נקבע";
}

export function meetingTimeLabel(iso: string): string {
  return TIME_FMT.format(new Date(iso));
}

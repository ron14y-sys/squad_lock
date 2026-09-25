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
  pinnedWhen: { date: string } | null;
}): string {
  if (meeting.currentDatetime)
    return DATE_FMT.format(new Date(meeting.currentDatetime));
  if (meeting.pinnedWhen) return formatLocalDate(meeting.pinnedWhen.date);
  return "טרם נקבע";
}

export function meetingTimeLabel(iso: string): string {
  return TIME_FMT.format(new Date(iso));
}

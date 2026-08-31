// Hebrew display labels for values whose *stored* form must stay the
// English literal the backend schema expects (lib/preferences/schema.ts).
// Translating the label here never touches the value sent to the API.

import type { LocalWeekday, MobilityMode } from "@/lib/types";

export const WEEKDAY_LABELS: Record<LocalWeekday, string> = {
  sunday: "א׳",
  monday: "ב׳",
  tuesday: "ג׳",
  wednesday: "ד׳",
  thursday: "ה׳",
  friday: "ו׳",
  saturday: "ש׳",
};

export const MOBILITY_MODE_LABELS: Record<MobilityMode, string> = {
  car: "רכב",
  transit: "תחבורה ציבורית",
  walk: "הליכה",
};

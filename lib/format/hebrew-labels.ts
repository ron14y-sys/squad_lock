// Hebrew display labels for values whose *stored* form must stay the
// English literal the backend schema expects (lib/preferences/schema.ts).
// Translating the label here never touches the value sent to the API.

import type { LocalWeekday, MobilityMode } from "@/lib/types";
import type { UnverifiedFact } from "@/lib/matching/constraints";
import type { MeetingCardStatus, ResponseStatus } from "@/lib/types/meeting";
import type { NotificationKind, RunStage } from "@/lib/generated/prisma/enums";

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

/** The feed and the meeting screen's own status vocabulary (spec §5.6). */
export const MEETING_CARD_STATUS_LABELS: Record<MeetingCardStatus, string> = {
  waiting_on_you: "ממתין לך",
  waiting_on_others: "ממתין לאחרים",
  reweighing: "משוקלל מחדש",
  conflicting: "מתנגש עם פגישה אחרת",
  stuck: "תקוע",
  closed: "סגור",
};

/**
 * The label a card wears (spec §5.6). "Waiting on others" carries the number
 * still to answer when it is known — "waiting on 2 others" says more than
 * "waiting on others". A meeting's opening search is `reweighing` too, but
 * nothing has been weighed yet, so it is not called "re-weighed".
 */
export function meetingStatusLabel(
  status: MeetingCardStatus,
  waitingOn: number | null,
  firstSearch = false
): string {
  if (status === "waiting_on_others" && waitingOn !== null) {
    return `ממתין לעוד ${waitingOn}`;
  }
  if (status === "reweighing" && firstSearch) return "מחפשים הצעה";
  return MEETING_CARD_STATUS_LABELS[status];
}

/** #169: what a spinner says while a run works through §4.1e's stages. */
export const RUN_STAGE_LABELS: Record<RunStage, string> = {
  calendars: "בודקים יומנים",
  places: "מחפשים מקומות",
  venue_details: "בודקים פרטי מקום",
  model: "בוחרים הצעה",
  saving: "שומרים",
};

export const RESPONSE_STATUS_LABELS: Record<ResponseStatus, string> = {
  pending: "טרם הגיב",
  approved: "אישר",
  cant_make_it: "לא יכול להגיע",
  doesnt_suit: "לא מתאים לו",
};

/**
 * The tags a venue can fail to be verified against. Free text on both sides
 * (`lib/types/profile.ts` keeps the vocabulary open), so an unknown tag is
 * shown as it was written rather than dropped or guessed at.
 */
const DIETARY_TAG_LABELS: Record<string, string> = {
  kosher: "כשרות",
  "vegan-option-required": "אפשרות טבעונית",
  shellfish: "פירות ים",
  gluten: "גלוטן",
  nuts: "אגוזים",
};

/**
 * "לא הצלחנו לאמת את שעות הפתיחה — כדאי לטלפן לפני שיוצאים."
 *
 * The ring-ahead note a proposal carries when A2 could not check something
 * (docs/decisions/hard-constraints.md). `null` when everything was checked.
 *
 * **Rendered here, never stored.** What the database keeps is the structured
 * `UnverifiedFact[]` the filter produced; this turns it into the sentence at
 * display time, exactly as WEEKDAY_LABELS does for a weekday. An earlier
 * version of A4 stored this English sentence in a column — which in an app
 * that is `lang="he" dir="rtl"` meant every historical row would have had to
 * be migrated to add the Hebrew.
 *
 * It states a fact about the venue and never a comparison: "we could not
 * confirm they are open" is honest, "you got this one because the better
 * place could not be verified" is what spec §5.6 forbids.
 */
export function unverifiedNote(
  facts: readonly UnverifiedFact[]
): string | null {
  if (facts.length === 0) return null;

  const parts = facts.map((fact) =>
    fact.kind === "opening_hours"
      ? "את שעות הפתיחה"
      : `אם הם עומדים בדרישת ${DIETARY_TAG_LABELS[fact.tag] ?? `״${fact.tag}״`}`
  );

  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")} ו${parts[parts.length - 1]}`;

  return `לא הצלחנו לאמת ${list} — כדאי לטלפן ולוודא לפני שיוצאים.`;
}

/** "חבר אחד" / "2 חברים" — Hebrew has a singular, so "1 חברים" reads as a mistake. */
export function membersLabel(count: number): string {
  return count === 1 ? "חבר אחד" : `${count} חברים`;
}

/**
 * #46 (C9): what each trigger says in the notification center — the same
 * five (now six, with `calendar_reconnect`) events `lib/email/notify.ts`
 * already emails about, in one short line instead of the email's full
 * paragraph. `invitation` is included for completeness (the enum has it)
 * even though `lib/db/notifications.ts` never actually writes one of this
 * kind — see that file's own comment.
 */
export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  invitation: "הוזמנת לקבוצה",
  proposal_waiting: "הוצעה פגישה — ממתינה לתשובה שלך",
  meeting_confirmed: "הפגישה אושרה",
  conflict_reweigh: "הפגישה נפתחה מחדש בגלל התנגשות",
  stuck: "לא מצאנו הצעה לפגישה — צריך להחליט ידנית",
  calendar_reconnect: "החיבור ליומן Google שלך הפסיק לעבוד",
};

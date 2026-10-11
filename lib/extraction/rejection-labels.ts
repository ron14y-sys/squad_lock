/**
 * The labels of a ticked rejection, and the words they stand for. Kept apart
 * from `labelled-rejection.ts` so the database layer and the request schema
 * can use them without loading the model client that file reaches through
 * `constraint-updater`.
 */

import {
  CUISINES,
  CUISINE_LABELS,
  VENUE_KINDS,
  VENUE_KIND_LABELS,
  type Cuisine,
  type VenueKind,
} from "@/lib/preferences/vocabulary";

/**
 * Not every option can be ruled out: a person who dismisses every style of
 * place, or every cuisine, leaves the search nothing to offer. One is always
 * left standing. The form enforces it and the request schema repeats it.
 */
export const MAX_AVOIDED_VENUE_KINDS = VENUE_KINDS.length - 1;
export const MAX_AVOIDED_CUISINES = CUISINES.length - 1;

export type RejectionLabels = {
  /** "The style of place doesn't suit me" — bar, café, restaurant. */
  venueKinds?: VenueKind[];
  /** "The kind of food doesn't suit me". */
  cuisines?: Cuisine[];
  tooFar?: boolean;
  /** "The hour doesn't suit me", and the local `HH:MM` that would. */
  suitableStart?: string;
  tooExpensive?: boolean;
};

/** Whether a rejection carries anything at all — an empty one corrects nothing. */
export function hasLabels(labels: RejectionLabels): boolean {
  return (
    (labels.venueKinds?.length ?? 0) > 0 ||
    (labels.cuisines?.length ?? 0) > 0 ||
    labels.tooFar === true ||
    labels.suitableStart !== undefined ||
    labels.tooExpensive === true
  );
}

/**
 * The labels as one Hebrew sentence. It is stored as the rejection's own
 * words, so the timeline shows something and the next weighing reads it like
 * any other.
 */
export function sentenceFromLabels(labels: RejectionLabels): string {
  const parts: string[] = [];
  if (labels.venueKinds?.length) {
    parts.push(
      `סגנון המקום (${labels.venueKinds.map((kind) => VENUE_KIND_LABELS[kind]).join(", ")})`
    );
  }
  if (labels.cuisines?.length) {
    parts.push(
      `סוג האוכל (${labels.cuisines.map((cuisine) => CUISINE_LABELS[cuisine]).join(", ")})`
    );
  }
  if (labels.tooFar) parts.push("רחוק לי מדי");
  if (labels.suitableStart !== undefined) {
    parts.push(`השעה לא מתאימה, מתאים לי ${labels.suitableStart}`);
  }
  if (labels.tooExpensive) parts.push("יקר לי מדי");
  return parts.length > 0 ? `לא מתאים לי: ${parts.join("; ")}` : "";
}

/**
 * The one sentence stored on the response and shown on the timeline: the
 * ticked reasons, then the person's own words if they wrote any.
 */
export function reasonTextOf(
  labels: RejectionLabels | undefined,
  text: string | undefined
): string {
  return [labels ? sentenceFromLabels(labels) : "", text ?? ""]
    .filter((part) => part !== "")
    .join(" · ");
}

/**
 * #213 follow-up: a rejection made by ticking what was wrong, instead of
 * writing it.
 *
 * The labels are the things the engine can act on, and nothing else: a place
 * of the wrong kind or cuisine, too far, the wrong hour, too expensive. Each
 * one is turned into the same `ConstraintUpdate` A7 returns for a sentence,
 * so everything downstream — `toleranceFor`, `startBoundsFor`,
 * `recordRejectionOutcome`, `blockedByRejections` — is unchanged, and no model
 * is called. Pure: no database, no clock.
 *
 * Something the engine cannot act on ("somewhere outside Ashdod") is not a
 * label. It goes in the free-text box, where it is recorded as untranslated.
 */

import { objectionOf, type ConstraintUpdate } from "./constraint-updater";
import { localTimeOf } from "./tonight-bounds";
import {
  CUISINE_LABELS,
  VENUE_KIND_LABELS,
  type Cuisine,
  type VenueKind,
} from "@/lib/preferences/vocabulary";
import type { TonightCorrection } from "@/lib/types";

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

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * What the labels ask for, in A7's shape.
 *
 * The hour is a direction decided by comparison: a start later than the
 * rejected one is "not before", an earlier one is "not after". The same hour
 * as the rejected start says nothing, so no bound is set. With no rejected
 * start to compare against there is nothing to decide a direction from, and
 * none is guessed.
 *
 * "Too far" is a direction too; `toleranceFor` turns it into kilometres from
 * the rejected venue, as it does for a sentence.
 */
export function constraintUpdateFromLabels(
  labels: RejectionLabels,
  rejectedStart: Date | null
): ConstraintUpdate {
  const softPreferences: TonightCorrection = {};
  if (labels.venueKinds?.length) {
    softPreferences.avoidVenueKinds = [...new Set(labels.venueKinds)];
  }
  if (labels.cuisines?.length) {
    softPreferences.avoidCuisines = [...new Set(labels.cuisines)];
  }
  if (labels.tooExpensive) softPreferences.budget = "modest";

  let start: ConstraintUpdate["start"] = null;
  if (labels.suitableStart !== undefined && rejectedStart) {
    const wanted = minutesOf(labels.suitableStart);
    const rejected = minutesOf(localTimeOf(rejectedStart));
    if (wanted > rejected) start = { notBefore: labels.suitableStart };
    if (wanted < rejected) start = { notAfter: labels.suitableStart };
  }

  const update = {
    softPreferences,
    distance: labels.tooFar ? ({ kind: "closer" } as const) : null,
    start,
    notThisPlace: false,
    untranslated: null,
  };
  return { ...update, objection: objectionOf(update) };
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

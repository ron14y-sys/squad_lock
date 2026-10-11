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
import { type RejectionLabels } from "./rejection-labels";
import { localTimeOf } from "./tonight-bounds";
import type { TonightCorrection } from "@/lib/types";

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

export {
  hasLabels,
  reasonTextOf,
  sentenceFromLabels,
  type RejectionLabels,
} from "./rejection-labels";

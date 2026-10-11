/**
 * A7 — what happens to a rejection between the response being stored and the
 * next weighing reading it.
 *
 * ```
 *   respondToMeeting commits  →  read what was rejected
 *                             →  runConstraintUpdater
 *                             →  record the correction and the outcome
 * ```
 *
 * **It never throws.** By the time it runs, the rejection is committed and
 * the cycle is spent (`tasks/a7-plan.md`, decision 4) — so failing the request
 * would show an error for work that succeeded, and the person would press
 * again and spend a second cycle on the same objection. Every failure
 * degrades to exactly the pre-A7 behaviour: no correction, and the next run
 * still happens with the rejected pair blocked and the person's own words in
 * the payload (decision 2).
 *
 * **But it is never silent.** What failed is recorded on the response — "the
 * model found nothing" and "the call died" look identical to the person and
 * need different fixes from us (decision 5).
 *
 * Kept out of both neighbours on purpose: `constraint-updater.ts` stays pure
 * so its guard rails can be tested with no database, and `lib/db/meetings.ts`
 * holds no prompts. This file is the only place the two meet.
 */

import {
  failureOutcome,
  runConstraintUpdater,
  type ConstraintUpdate,
} from "./constraint-updater";
import { constraintUpdateFromLabels } from "./labelled-rejection";
import { sentenceFromLabels, type RejectionLabels } from "./rejection-labels";
import { startBoundsFor, toleranceFor } from "./tonight-bounds";
import {
  findRejectedOption,
  findTonightReach,
  recordRejectionOutcome,
  type RejectedOption,
} from "@/lib/db/meetings";
import { straightLineKm } from "@/lib/matching/distance";

/**
 * Turns an update — read from a sentence or from ticked labels — into this
 * meeting's numbers and writes the row. One path for both, so a label and a
 * sentence that mean the same thing are recorded the same way.
 *
 * #220: "too far" and "too late" become this meeting's numbers here,
 * measured against what was rejected — neither the model nor the form picks
 * them.
 */
async function recordUpdate(
  meetingId: string,
  userId: string,
  update: ConstraintUpdate,
  reasonText: string,
  rejected: RejectedOption
): Promise<void> {
  const reach = update.distance
    ? await findTonightReach(meetingId, userId)
    : null;
  const toleranceKm = toleranceFor(update.distance, {
    distanceKm:
      reach?.origin && rejected.location
        ? straightLineKm(reach.origin, rejected.location)
        : null,
    currentKm: reach?.toleranceKm ?? 0,
  });
  const { earliestStart, latestStart } = startBoundsFor(
    update.start,
    rejected.slot.start
  );

  const hasCorrection = Object.keys(update.softPreferences).length > 0;
  await recordRejectionOutcome(
    meetingId,
    userId,
    update.objection,
    // The row is written either way, because the sentence has to survive
    // this person's next rejection overwriting `Response.reasonText` (A8).
    hasCorrection ? update.softPreferences : null,
    reasonText,
    {
      toleranceKm,
      earliestStart,
      latestStart,
      untranslated: update.untranslated,
    }
  );
}

/**
 * A rejection made by ticking labels. It reads no model and, like the
 * sentence path, never throws: by now the rejection is committed and the
 * cycle spent. If recording fails the sentence is still kept, as a rejection
 * nothing understood (`none`), so the next weighing at least has the words.
 */
export async function applyLabelledRejection(
  meetingId: string,
  userId: string,
  labels: RejectionLabels
): Promise<void> {
  const sentence = sentenceFromLabels(labels);
  try {
    const rejected = await findRejectedOption(meetingId);
    if (!rejected) return;

    const update = constraintUpdateFromLabels(labels, rejected.slot.start);
    await recordUpdate(meetingId, userId, update, sentence, rejected);
  } catch (error) {
    console.error(
      `[a7] labelled rejection failed meeting=${meetingId} user=${userId}`,
      error
    );
    try {
      await recordRejectionOutcome(meetingId, userId, "none", null, sentence);
    } catch (writeError) {
      console.error(`[a7] could not record the failure`, writeError);
    }
  }
}

export async function applyRejection(
  meetingId: string,
  userId: string,
  reasonText: string
): Promise<void> {
  try {
    const rejected = await findRejectedOption(meetingId);
    // Nothing was proposed, so there is nothing this objection is *about*.
    // The column stays null: no extraction was attempted, which is a
    // different fact from one that was attempted and found nothing.
    if (!rejected) return;

    const { update } = await runConstraintUpdater({
      reasonText,
      rejected: {
        venueName: rejected.venueName,
        // Neither is stored anywhere yet — see `findRejectedOption`. Absent
        // rather than invented.
        neighbourhood: null,
        venueIs: null,
        slot: rejected.slot,
      },
    });

    await recordUpdate(meetingId, userId, update, reasonText, rejected);
  } catch (error) {
    // One line, greppable, in the shape A1's cost log already uses.
    console.error(
      `[a7] extraction failed meeting=${meetingId} user=${userId}`,
      error
    );

    try {
      await recordRejectionOutcome(
        meetingId,
        userId,
        failureOutcome(error),
        null,
        // The extraction failed; the sentence did not. It still reaches the
        // next weighing verbatim, which for some objections is all there
        // ever was (tasks/a8-plan.md, step 3).
        reasonText
      );
    } catch (writeError) {
      // The database is what just failed, so there is nowhere left to record
      // anything. Say so and let the response through.
      console.error(`[a7] could not record the failure`, writeError);
    }
  }
}

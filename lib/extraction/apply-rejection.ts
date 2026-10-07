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

import { failureOutcome, runConstraintUpdater } from "./constraint-updater";
import { startBoundsFor, toleranceFor } from "./tonight-bounds";
import {
  findRejectedOption,
  findTonightReach,
  recordRejectionOutcome,
} from "@/lib/db/meetings";
import { straightLineKm } from "@/lib/matching/distance";

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

    // #220: "too far" and "too late" become this meeting's numbers here,
    // measured against what was rejected — the model never picks them.
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

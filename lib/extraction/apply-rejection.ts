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
import { findRejectedOption, recordRejectionOutcome } from "@/lib/db/meetings";

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

    await recordRejectionOutcome(
      meetingId,
      userId,
      update.objection,
      // A correction row exists only when there is a correction. The other
      // four outcomes are recorded on the response and nowhere else.
      update.objection === "soft" ? update.softPreferences : null
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
        null
      );
    } catch (writeError) {
      // The database is what just failed, so there is nowhere left to record
      // anything. Say so and let the response through.
      console.error(`[a7] could not record the failure`, writeError);
    }
  }
}

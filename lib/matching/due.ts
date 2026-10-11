// When is a meeting due for a run?
//
// The four timers and the two pure functions that read them, split out of
// `run-cycle.ts` (#215) so a screen can ask "when" without importing the
// model, the Places client and the mail sender along with it. `run-cycle.ts`
// re-exports all of it, so nothing that imported it from there changes.

/**
 * How long new ParticipantMeetingContext rows -- rejections or amendments --
 * are collected before they are answered with one run.
 *
 * B11: this was rejection-only until amendments needed the identical thing
 * (spec §3.2: "an amendment opens a ~90-second window; further amendments
 * reset it; when it closes, one run covers all of them") -- the same
 * reasoning A8 already had for rejections clustering (below), so one window
 * now serves both rather than two copies of the same idea.
 *
 * Measured from the **first** unanswered row since the last run, not the
 * latest: a fixed window is a thing that can be explained to somebody, and
 * one that reset on every row could keep sliding while objections or
 * amendments trickle in.
 *
 * This is what makes the cap mean anything for a rejection. "A cycle is a
 * proposal" (#125) bounds nothing on its own, because every run produces
 * something new to reject — three rejections twenty seconds apart would
 * otherwise reach the cap in under a minute, with three proposals nobody
 * read. An amendment has no such cap concern (the first is free, spec
 * §3.1), but clusters the same way: several people open the same proposal
 * within the same couple of minutes, and firing one run per amendment would
 * replace it before anyone finished reading it either.
 */
export const CONTEXT_BATCH_MS = 90_000;

/**
 * Every proposal gets this long on screen before it can be replaced.
 *
 * The other half of bounding the cap, and the more useful half: the wait is
 * longest exactly when the proposal is newest, which is when the rest of the
 * group is most likely still to join the same batch. A proposal two hours old
 * that somebody rejects waits only `CONTEXT_BATCH_MS`, because there is
 * nobody left to wait for.
 */
export const MIN_PROPOSAL_LIFETIME_MS = 5 * 60_000;

/**
 * How long a meeting is left alone after somebody last touched it.
 *
 * Not a product rule — a guard against the feed's own polling. C5 polls every
 * three seconds while a meeting on screen is `weighing`, and a run takes 6-23
 * seconds, so without this roughly five polls would each start their own run
 * of the same cycle. `MatchRun` is unique on `(meetingId, cycleNumber)` so
 * only one could ever be written, but all five would pay: five calls out of
 * Gemini's twenty a day, and five times the Places quota.
 *
 * It doubles as the retry interval. A fault leaves the meeting in `weighing`
 * for the next poll (step 5), and without a cooldown "the next poll" is three
 * seconds later, forever.
 */
export const RUN_ATTEMPT_COOLDOWN_MS = 90_000;

export type DueInput = {
  /** Last time anything wrote to the meeting — including a claim. */
  updatedAt: Date;
  /** When the current proposal was made, or null if there is none yet. */
  lastRunAt: Date | null;
  /**
   * The earliest ParticipantMeetingContext row **no run has seen yet**, if
   * any -- a rejection or an amendment, whichever is older (B11: this used
   * to be rejections only; see `CONTEXT_BATCH_MS`'s own comment for why one
   * field now covers both).
   *
   * Not "since the last run": a `MatchRun` is stamped when it is written, so
   * a row written while a run was in flight is older than the run that
   * never saw it. `MatchRunSeenContext` records what each run read, which
   * answers the question exactly instead of approximately.
   */
  firstUnseenContextAt: Date | null;
  /**
   * B9 part two — set only after a rate-limited fault (`faultRetryNotBefore`),
   * `null` otherwise. When set, no attempt is due before it, however long
   * ago `updatedAt` was — see `Meeting.retryNotBefore`'s own comment.
   */
  retryNotBefore: Date | null;
};

/**
 * The earliest instant `isDue` becomes true, if nothing about the meeting
 * changes before then — or `null` when only something new (a rejection, an
 * amendment) can make it due (#215).
 *
 * `isDue` is defined in terms of this, so the time a screen is told and the
 * moment a run actually starts cannot drift apart: each timer is read once,
 * here. The caller has already narrowed to `status === "weighing"`, as for
 * `isDue`.
 *
 * It is the earliest the *rules* allow, not when a run will start: no
 * background job runs it, so it starts at the first poll after this
 * instant — which is why `isDue` and not this decides whether to run.
 */
export function nextRunAt(meeting: DueInput): Date | null {
  // Never before the cooldown since anybody last touched the meeting, nor
  // before the end of a rate-limit wait.
  let at = meeting.updatedAt.getTime() + RUN_ATTEMPT_COOLDOWN_MS;
  if (meeting.retryNotBefore !== null) {
    at = Math.max(at, meeting.retryNotBefore.getTime());
  }

  // Nothing has ever been proposed. Normally step 7 runs the first cycle at
  // initiation; reaching here means that run failed, so this is the retry.
  if (!meeting.lastRunAt) return new Date(at);

  // A proposal is out and the meeting is in `weighing`, which only a
  // rejection or an amendment does. Nothing unanswered means neither has
  // been written down yet.
  if (!meeting.firstUnseenContextAt) return null;

  return new Date(
    Math.max(
      at,
      meeting.firstUnseenContextAt.getTime() + CONTEXT_BATCH_MS,
      meeting.lastRunAt.getTime() + MIN_PROPOSAL_LIFETIME_MS
    )
  );
}

/**
 * Is this meeting waiting for a run right now?
 *
 * Pure, so the timers above can be tested without a database, a clock or a
 * model. The caller has already narrowed to `status === "weighing"` —
 * `awaiting` means a proposal is out and nobody has objected or amended, and
 * `stuck`, `closed` and `cancelled` are not weighed again.
 */
export function isDue(meeting: DueInput, now: Date): boolean {
  const at = nextRunAt(meeting);
  return at !== null && now.getTime() >= at.getTime();
}

/**
 * Waiting out a refusal that is not a refusal.
 *
 * Extracted from `scripts/run-evals.ts` when A7's constraint sweep became its
 * second caller, and it earned the move immediately: the first live run of
 * that sweep lost six of eight cases to "high demand" — the exact failure A5
 * had already recorded once, where three scenarios were written down as model
 * failures when the model had simply said "later".
 *
 * The distinction this file exists for: **an overload clears on its own in
 * seconds; a quota does not, and retrying it burns the very window it is
 * asking us to wait for.** So a busy model is waited out, and a rate limit is
 * waited out only when the API itself names a short delay — which is how it
 * tells a per-minute pace apart from a daily cap.
 */

import { isOverloaded, isRateLimited, retryDelayMs } from "@/lib/llm/client";

/** How many times a transient refusal is worth retrying before giving up. */
const RETRIES = 3;

/**
 * The longest wait worth sitting through.
 *
 * A rate limit comes in two sizes and the API distinguishes them for us: the
 * per-minute window says "retry in 16s" and is simply the pace this tier runs
 * at, while the per-day cap either gives no delay or gives one measured in
 * hours. Waiting out the first is how a free-tier sweep completes at all;
 * waiting out the second means blocking until tomorrow.
 */
const MAX_WAIT_MS = 90_000;

export const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withRetries<T>(
  attempt: () => Promise<T>,
  options: { paceMs: number; retries?: number } = { paceMs: 20_000 }
): Promise<T> {
  const retries = options.retries ?? RETRIES;

  for (let tries = 0; ; tries += 1) {
    try {
      return await attempt();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const busy = isOverloaded(message);
      const asked = retryDelayMs(message);

      const delay = busy
        ? (asked ?? (tries + 1) * options.paceMs)
        : isRateLimited(message) && asked !== null && asked <= MAX_WAIT_MS
          ? asked + 2_000
          : null;

      if (delay === null || tries >= retries) throw error;

      console.log(
        `  … ${busy ? "busy" : "pacing"}, waiting ${Math.round(delay / 1000)}s (attempt ${tries + 2} of ${retries + 1})`
      );
      await pause(delay);
    }
  }
}

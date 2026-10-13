"use client";

import { useEffect, useRef } from "react";

/**
 * #269: how every screen keeps itself up to date — the feed, the all-groups
 * screen and the meeting screen. Calls `poll` every `delay` ms while the page
 * is on screen, and once at once whenever it comes back to the foreground.
 * Backgrounded, nothing (spec §5.6). A `null` delay asks only on coming back.
 * The first load is the screen's own; this is only what follows it.
 */
export function usePolling(poll: () => void, delay: number | null) {
  const latest = useRef(poll);
  useEffect(() => {
    latest.current = poll;
  });

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") latest.current();
    };
    const intervalId = delay === null ? undefined : setInterval(tick, delay);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [delay]);
}

/**
 * A list of meeting cards: every 3 s while one of them is being weighed, every
 * 30 s while any is still open to an answer, and not at all otherwise — a
 * meeting someone else opens then shows on coming back, and its email and
 * notification carry it meanwhile.
 */
export function cardsPollDelay(
  cards: readonly { status: string; runStage?: string | null }[]
): number | null {
  if (cards.some((card) => card.runStage)) return 3_000;
  const open = [
    "waiting_on_you",
    "waiting_on_others",
    "reweighing",
    "conflicting",
  ];
  return cards.some((card) => open.includes(card.status)) ? 30_000 : null;
}

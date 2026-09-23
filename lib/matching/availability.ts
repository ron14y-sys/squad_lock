/**
 * B6 — group availability (spec §5.4, §5.7, #86, #89).
 *
 * Two things, and both are pure: no LLM, no network, no clock. The actual
 * Google Calendar free/busy fetch that fills `Participant.busy` is a
 * separate piece (B6b) — this file only turns busy blocks that are already
 * in hand into what the rest of the funnel needs.
 *
 * 1. **`commonFreeWindows`** is the group's raw free time. Per
 *    `docs/decisions/slot-trimming.md`, this file no longer slices those
 *    windows into fixed-length candidate slots itself — each free window is
 *    handed, as-is, to `constraints.ts`'s `trimPairToViableSlots` per
 *    candidate, which narrows it by opening hours and reach and only then
 *    checks `meetsMinimumLength`. The same minimum also gates the raw free
 *    window before any venue is considered (the `stuck` case, spec §9) —
 *    `constraints.ts`'s comment on `meetsMinimumLength` says B6 owns making
 *    that call.
 * 2. **`slotTolerance`** is the composition `constraints.ts` describes and
 *    asks for by name: `min(profile.toleranceKm, cap ?? Infinity)`, done here
 *    rather than in the Context Resolver (A12) because the Resolver ships
 *    dark and falls back — a Resolver-only version would hand a car-sized
 *    tolerance to someone who cannot drive every time it was off. This is
 *    separate from the reach narrowing `trimPairToViableSlots` applies — the
 *    decision doc keeps `toleranceKm` out of that function on purpose, since
 *    it is a soft cost for burden calc, not a hard constraint.
 */

import type {
  Kilometres,
  Participant,
  SlotTolerance,
  TimeSlot,
} from "@/lib/types";
import { reachCapKm } from "./constraints";

/* -------------------------------------------------------------------------
 * Common free time
 * ---------------------------------------------------------------------- */

/** Part of `slot` that falls inside `window`, or `null` if none does. */
function clipToWindow(slot: TimeSlot, window: TimeSlot): TimeSlot | null {
  const start = new Date(
    Math.max(slot.start.getTime(), window.start.getTime())
  );
  const end = new Date(Math.min(slot.end.getTime(), window.end.getTime()));
  if (start.getTime() >= end.getTime()) return null;
  return { start, end };
}

/** Sorted, merged so no two intervals in the result touch or overlap. */
function mergeIntervals(slots: TimeSlot[]): TimeSlot[] {
  if (slots.length === 0) return [];

  const sorted = [...slots].sort(
    (a, b) => a.start.getTime() - b.start.getTime()
  );
  const merged: TimeSlot[] = [sorted[0]];

  for (const current of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (current.start.getTime() <= last.end.getTime()) {
      if (current.end.getTime() > last.end.getTime()) {
        merged[merged.length - 1] = { start: last.start, end: current.end };
      }
    } else {
      merged.push(current);
    }
  }

  return merged;
}

/**
 * Free time common to every participant, within `searchWindow`.
 *
 * "Busy for someone" and "not free for the group" are the same fact, so the
 * whole group's busy blocks are merged into one timeline first; what is left
 * over inside `searchWindow` is the group's common free time. This is the
 * intersection of every participant's free time, computed as the complement
 * of a union — cheaper than intersecting N free-time sets directly, and the
 * same answer.
 *
 * `searchWindow` is a plain parameter, not a default computed in here — this
 * file stays clock-free, same as `constraints.ts`. Whoever calls this decides
 * how far ahead to look.
 */
export function commonFreeWindows(
  participants: Participant[],
  searchWindow: TimeSlot
): TimeSlot[] {
  if (searchWindow.end.getTime() <= searchWindow.start.getTime()) {
    throw new Error("availability: searchWindow must end after it starts");
  }

  const busy = mergeIntervals(
    participants
      .flatMap((participant) => participant.busy)
      .map((block) => clipToWindow(block, searchWindow))
      .filter((block): block is TimeSlot => block !== null)
  );

  const free: TimeSlot[] = [];
  let cursor = searchWindow.start;

  for (const block of busy) {
    if (block.start.getTime() > cursor.getTime()) {
      free.push({ start: cursor, end: block.start });
    }
    if (block.end.getTime() > cursor.getTime()) {
      cursor = block.end;
    }
  }

  if (cursor.getTime() < searchWindow.end.getTime()) {
    free.push({ start: cursor, end: searchWindow.end });
  }

  return free;
}

/* -------------------------------------------------------------------------
 * Slot tolerance
 * ---------------------------------------------------------------------- */

/**
 * One person's travel tolerance at one slot — the continuous half of §5.4's
 * mobility rule, composed exactly as `constraints.ts`'s own comment on
 * `reachCapKm` specifies: the profile's baseline, narrowed by whatever mode
 * cap applies at that hour, never widened by it. `reachCapKm` returning
 * `null` means nothing caps them beyond their own stated tolerance.
 */
export function slotTolerance(
  participant: Participant,
  slot: TimeSlot
): SlotTolerance {
  const cap = reachCapKm(participant, slot);
  const toleranceKm: Kilometres =
    cap === null
      ? participant.profile.toleranceKm
      : Math.min(participant.profile.toleranceKm, cap);

  return { participantId: participant.userId, slot, toleranceKm };
}

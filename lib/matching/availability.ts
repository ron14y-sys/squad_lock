/**
 * B6 — group availability (spec §5.4, §5.7, #86, #89).
 *
 * Two things, and both are pure: no LLM, no network, no clock. The actual
 * Google Calendar free/busy fetch that fills `Participant.busy` is a
 * separate piece (B6b) — this file only turns busy blocks that are already
 * in hand into what the rest of the funnel needs.
 *
 * 1. **`commonFreeWindows` + `candidateSlots`** produce `ConstraintInput.slots`
 *    — `constraints.ts` names this file as the producer in its own comment.
 * 2. **`slotTolerance`** is the composition `constraints.ts` describes and
 *    asks for by name: `min(profile.toleranceKm, cap ?? Infinity)`, done here
 *    rather than in the Context Resolver (A12) because the Resolver ships
 *    dark and falls back — a Resolver-only version would hand a car-sized
 *    tolerance to someone who cannot drive every time it was off.
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
 * Candidate slots
 * ---------------------------------------------------------------------- */

/**
 * The shortest meeting worth proposing (#86). Applied here — a free window
 * under this is dropped, not truncated to something shorter — and again,
 * separately, wherever a (venue, time) pair gets narrowed by opening hours.
 */
export const MIN_MEETING_HOURS = 3;

const MS_PER_HOUR = 60 * 60 * 1000;
const MIN_MEETING_MS = MIN_MEETING_HOURS * MS_PER_HOUR;

/** How far apart successive candidate slots start, inside one free window. */
const SLOT_STEP_MS = MS_PER_HOUR;

/**
 * `MIN_MEETING_HOURS`-long candidate slots carved out of free windows.
 *
 * A single long free window (say, six hours) cannot be handed to `A2` as one
 * slot: `windowsCoverSlot` requires a venue to be open for the *whole* slot,
 * and a venue open 18:00–22:00 would then be wrongly dropped from a
 * 17:00–23:00 window even though a real three-hour meeting fits inside it
 * fine. So this slides a fixed `MIN_MEETING_HOURS` window through each free
 * window in hourly steps, producing the actual proposable start times.
 *
 * A free window shorter than `MIN_MEETING_HOURS` contributes nothing. An
 * empty result overall — no free window anywhere long enough — is the
 * `stuck` case spec §9 describes, decided by whoever calls this.
 */
export function candidateSlots(freeWindows: TimeSlot[]): TimeSlot[] {
  const slots: TimeSlot[] = [];

  for (const window of freeWindows) {
    const latestStart = window.end.getTime() - MIN_MEETING_MS;
    for (
      let start = window.start.getTime();
      start <= latestStart;
      start += SLOT_STEP_MS
    ) {
      slots.push({
        start: new Date(start),
        end: new Date(start + MIN_MEETING_MS),
      });
    }
  }

  return slots;
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

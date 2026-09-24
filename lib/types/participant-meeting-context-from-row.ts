/**
 * The `ParticipantMeetingContext` converter, following `meetingFromRow`'s
 * shape (B5). The seam it hides: the database keeps the origin override as
 * two float columns (`originLat`, `originLng`), same reason and same fix as
 * `preferenceProfileFromRow`'s `home`.
 *
 * `mobilityWindows` arrives from Prisma typed as `JsonValue` — structurally
 * correct but shapeless. The cast back to `MobilityWindow[]` here is safe
 * *because* the amendment endpoint (`lib/db/meetings.ts`'s
 * `respondToMeeting`) is the only writer and validates every write against
 * the same shape (`lib/meetings/schema.ts`'s `respondToMeetingSchema`)
 * before it reaches this table.
 *
 * `softPreferences` is the same kind of cast, and is safe on the same terms:
 * A7's Constraint Updater is its only writer, and it validates against its
 * own schema before the value reaches this table. `null` means no correction
 * — the state every amendment row is in (issue #86).
 *
 * `mergeContexts` below is the other half of reading this table: one person
 * has *several* rows per meeting, and turning them into the single context a
 * run works from is not "take the last one". See its own comment.
 */

import type { ParticipantMeetingContextModel } from "@/lib/generated/prisma/models";

import type { SoftPreferences } from "./profile";

import type { MobilityWindow, ParticipantMeetingContext } from "./meeting";

export function participantMeetingContextFromRow(
  row: ParticipantMeetingContextModel
): ParticipantMeetingContext {
  return {
    id: row.id,
    meetingId: row.meetingId,
    userId: row.userId,
    origin:
      row.originLat !== null && row.originLng !== null
        ? { lat: row.originLat, lng: row.originLng }
        : null,
    originLabel: row.originLabel,
    mobilityWindows: row.mobilityWindows as MobilityWindow[],
    softPreferences: row.softPreferences as SoftPreferences | null,
    note: row.note,
    createdAt: row.createdAt,
  };
}

/**
 * Every row this person has on this meeting, as the one context a run works
 * from (A8, and the read B11 described but nobody had written yet).
 *
 * **Field-wise, never row-wise**, because rows append rather than update —
 * that is what lets the timeline say which objection triggered which
 * re-weighing (`lib/db/meetings.ts`, `recordRejectionOutcome`). The two
 * writers leave different halves blank:
 *
 * | Row | `origin` | `softPreferences` |
 * | --- | -------- | ----------------- |
 * | an amendment ("tonight I'm coming from work") | set | `NULL` |
 * | an A7 correction ("too loud for me")          | `NULL` | set |
 *
 * So taking the newest row loses whichever came first. Dana amends at 19:00
 * and rejects at 20:30; row-wise, her next run measures her distance from
 * home again, and the amendment she made an hour ago is silently gone.
 *
 * Each field therefore comes from the newest row that **has** it. Two rules
 * that are easy to get wrong:
 *
 * - **`origin` and `originLabel` move together.** They are picked from one
 *   row, never two, so a label can never end up describing somebody else's
 *   coordinates. A label with no coordinates is a real state — C7's form
 *   lets you type "from work" without dropping a pin — and it wins as a unit.
 * - **`softPreferences` merges field by field, like everything else here.**
 *   Two corrections are usually two complaints about two different things —
 *   "too loud" at 20:30 and "too expensive" at 21:15 are both still true —
 *   so replacing the object wholesale would drop the first one. Merging
 *   across fields is not the same as accumulating *within* one: "quiet"
 *   after "lively" is a change of mind, and the newest value still wins on
 *   that field. A7 writes a row only for a `soft` objection, so no row here
 *   carries an empty correction that could blank one out.
 *
 * `contexts` is oldest-first, as `createdAt: "asc"` returns it. The merged
 * object carries the newest row's `id` and `createdAt` — it is a view, not a
 * row, and whoever needs the id of *every* row a run read (for
 * `MatchRunSeenContext`) has the list already and does not go through here.
 */
export function mergeContexts(
  contexts: readonly ParticipantMeetingContext[]
): ParticipantMeetingContext | null {
  const newest = contexts[contexts.length - 1];
  if (!newest) return null;

  const newestWith = (has: (context: ParticipantMeetingContext) => boolean) => {
    for (let i = contexts.length - 1; i >= 0; i -= 1) {
      if (has(contexts[i])) return contexts[i];
    }
    return undefined;
  };

  const origin = newestWith(
    (context) => context.origin !== null || context.originLabel !== null
  );

  return {
    id: newest.id,
    meetingId: newest.meetingId,
    userId: newest.userId,
    origin: origin?.origin ?? null,
    originLabel: origin?.originLabel ?? null,
    mobilityWindows:
      newestWith((context) => context.mobilityWindows.length > 0)
        ?.mobilityWindows ?? [],
    softPreferences: contexts.reduce<SoftPreferences | null>(
      (merged, context) =>
        context.softPreferences
          ? { ...merged, ...context.softPreferences }
          : merged,
      null
    ),
    note: newestWith((context) => context.note !== null)?.note ?? null,
    createdAt: newest.createdAt,
  };
}

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
 * `softPreferences` is always `null` here: the type's own comment says why
 * — `participant_meeting_contexts` has no column for it yet, B11 adds the
 * column and the migration together, and until then nothing reads it back
 * from the database (issue #86).
 */

import type { ParticipantMeetingContextModel } from "@/lib/generated/prisma/models";

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
    softPreferences: null,
    note: row.note,
    createdAt: row.createdAt,
  };
}

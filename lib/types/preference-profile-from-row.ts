/**
 * The `PreferenceProfile` converter, following `meetingFromRow`'s shape
 * (B3). The seam it hides: the database keeps home location as two float
 * columns (`homeLat`, `homeLng`) because that is what an optional pair of
 * nullable columns looks like in SQL, while the app speaks of one `LatLng`
 * or `null` — nothing outside this file should know they are ever apart.
 *
 * `hardConstraints`, `softPreferences` and `recurringMobilityRules` arrive
 * from Prisma typed as `JsonValue` — structurally correct but shapeless.
 * The cast back to the real types here is safe *because* `/api/preferences`
 * is the only writer and it validates every write against the same shapes
 * (`lib/preferences/schema.ts`) before it reaches this table.
 */

import type { PreferenceProfileModel } from "@/lib/generated/prisma/models";

import type {
  HardConstraints,
  PreferenceProfile,
  RecurringMobilityRule,
  SoftPreferences,
} from "./profile";

export function preferenceProfileFromRow(
  row: PreferenceProfileModel
): PreferenceProfile {
  return {
    id: row.id,
    userId: row.userId,
    hardConstraints: row.hardConstraints as HardConstraints,
    softPreferences: row.softPreferences as SoftPreferences,
    home:
      row.homeLat !== null && row.homeLng !== null
        ? { lat: row.homeLat, lng: row.homeLng }
        : null,
    homeNeighbourhood: row.homeNeighbourhood,
    toleranceKm: row.toleranceKm,
    recurringMobilityRules:
      row.recurringMobilityRules as RecurringMobilityRule[],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

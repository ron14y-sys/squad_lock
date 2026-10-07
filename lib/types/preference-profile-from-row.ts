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
 *
 * ⚠️ **Except that it is not the only writer, and `hardConstraints` needed
 * the three arrays filled in.** The column is `@default("{}")`, so a profile
 * row that nobody has written to carries an empty object — which is every
 * user who signed up and has not opened C3's hard-constraints screen. The
 * cast then promises three arrays that are not there, and the first thing to
 * iterate one crashes: `participantViolations` in `lib/matching/constraints.ts`
 * does `for (const window of hardConstraints.unavailable)`, which A8's
 * verification script hit on its first run against the real database.
 *
 * Filling them here is the same job this file already does for
 * `homeLat`/`homeLng`: hide a difference between what SQL stores and what the
 * app speaks. An absent list means "nothing stated", which is exactly `[]` —
 * and unlike the origin, there is no meaningful `null` for it.
 *
 * `softPreferences` is not cast but read through `softPreferencesFromJson`:
 * the column has outlived one vocabulary (#217), and only the current one may
 * reach A4. `{}` is a real state for it
 * ([#86](https://github.com/ron14y-sys/squad_lock/issues/86)).
 * `recurringMobilityRules` defaults to `[]` in the column already.
 */

import type { PreferenceProfileModel } from "@/lib/generated/prisma/models";

import type {
  HardConstraints,
  PreferenceProfile,
  RecurringMobilityRule,
} from "./profile";
import { softPreferencesFromJson } from "@/lib/preferences/vocabulary";

export function preferenceProfileFromRow(
  row: PreferenceProfileModel
): PreferenceProfile {
  return {
    id: row.id,
    userId: row.userId,
    hardConstraints: {
      dietary: [],
      allergies: [],
      unavailable: [],
      ...(row.hardConstraints as Partial<HardConstraints>),
    },
    softPreferences: softPreferencesFromJson(row.softPreferences),
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

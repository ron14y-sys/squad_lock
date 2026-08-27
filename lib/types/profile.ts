/**
 * The standing facts about a person, independent of any one meeting
 * (spec §5.1, table `preference_profiles`).
 *
 * Three of this file's shapes were `Json` in the database on purpose — the
 * screens that produce them are still being iterated on. They are given real
 * shapes here anyway, because deterministic code branches on them: the
 * hard-constraint filter (§4.1b) and the burden denominator (§5.4). A shape
 * A-track invents privately is a shape B-track has to guess at.
 *
 * `softPreferences` is the exception, and stays `unknown` — see below.
 */

import type {
  Kilometres,
  LatLng,
  LocalWeekday,
  LocalWindow,
} from "./primitives";

/** How a person can get somewhere. Tags a mobility rule or window. */
export type MobilityMode = "car" | "transit" | "walk";

/**
 * Enforced in code, never delegated to the model (spec §4.1b): filtered out
 * before the agent sees a candidate, and re-checked against its answer.
 *
 * Free-text entries — `"kosher"`, `"shellfish"` — rather than enums, because
 * the vocabulary is still open and an unknown value must be *carried*, not
 * dropped. Whatever normalises them belongs with the filter, not here.
 */
export type HardConstraints = {
  /** Kosher, halal, vegetarian — anything that rules a venue out outright. */
  dietary: string[];
  /** Severe allergies. A venue that cannot accommodate one is not a candidate. */
  allergies: string[];
  /**
   * Fixed unavailable hours. These affect *availability* — distinct from the
   * mobility rules below, which affect *distance* (spec §5.1).
   */
  unavailable: LocalWindow[];
};

/**
 * "No car on Fridays", "Tuesdays I come from work" (spec §5.1).
 *
 * Two genuinely different statements, so two variants rather than one shape
 * with half its fields empty. Both are part of the profile, not of a meeting:
 * they apply to the *first* proposal, which is what makes them the cheap half
 * of the amendment mechanism (§5.7).
 */
export type RecurringMobilityRule =
  | {
      kind: "mode_unavailable";
      weekdays: LocalWeekday[];
      mode: MobilityMode;
      /** Narrows the rule to part of the day. Absent means the whole day. */
      window?: LocalWindow;
    }
  | {
      kind: "origin_override";
      weekdays: LocalWeekday[];
      /** "work", "my parents' place" — as the person wrote it. */
      originLabel: string;
      /** Absent until something geocodes the label. */
      origin?: LatLng;
    };

export type PreferenceProfile = {
  id: string;
  userId: string;

  hardConstraints: HardConstraints;

  /**
   * Cuisine, budget, atmosphere, noise level — soft signal only (spec §5.1).
   *
   * Deliberately untyped. Nothing deterministic ever branches on it; it is
   * passed to the model as-is and shaped by A4's JSON Schema at that boundary,
   * where validation belongs. Give it a shape here and we would be freezing a
   * product decision the preference game has not made yet.
   */
  softPreferences: unknown;

  /** Both database columns are nullable together; `null` means not set yet. */
  home: LatLng | null;
  homeNeighbourhood: string | null;

  /**
   * The baseline travel tolerance. The Context Resolver layers a per-slot
   * tolerance on top of this at match time (spec §5.1, §5.4) — it is never
   * the thing the funnel divides by directly.
   */
  toleranceKm: Kilometres;

  recurringMobilityRules: RecurringMobilityRule[];

  createdAt: Date;
  updatedAt: Date;
};

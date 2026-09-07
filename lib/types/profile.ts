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
 * `softPreferences` was the exception while its shape was undecided — the
 * preference game (C2) now decides it. See `SoftPreferences` below.
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

/**
 * The initial signal from the this-or-that preference game (spec §5.1, C2).
 * Four binary levers, not a free-text description, so the set can be handed
 * to the matching agent without any parsing step.
 *
 * **Every field is optional, and an absent one must change nothing.** Not
 * having an opinion about noise is a real state — someone skipped that
 * question, or the profile predates it — and it is not the same as wanting
 * either answer. A missing field may never cost a venue a place or win it
 * one; the agent weighs the fields that are present and is silent about the
 * rest (decided on [#86](https://github.com/ron14y-sys/squad_lock/issues/86)).
 *
 * That is already how the deterministic column behaves, because nothing in it
 * branches on `softPreferences` at all. The obligation is A4's prompt and
 * A6's justification check, and it is written into both.
 *
 * C2 therefore needs a way to decline a question rather than forcing four
 * answers, or it will manufacture opinions nobody holds.
 *
 * `VenueSoftFacts` in `./matching` is `Partial<SoftPreferences>` on purpose:
 * a venue answers the same four questions a person does, so matching one to
 * the other is a field comparison rather than a vocabulary translation.
 */
export type SoftPreferences = {
  noiseLevel?: "lively" | "quiet";
  activityStyle?: "outdoorsy" | "cultural";
  budget?: "modest" | "splurge";
  cuisine?: "familiar" | "adventurous";
};

export type PreferenceProfile = {
  id: string;
  userId: string;

  hardConstraints: HardConstraints;

  /**
   * Cuisine, budget, atmosphere, noise level — soft signal only (spec §5.1).
   * Nothing deterministic branches on it; the model reads it as-is and A4's
   * JSON Schema is the real validation boundary. Typed here anyway so the
   * preference game (C2) and anything that renders a profile agree on a
   * shape, rather than each guessing at an `unknown`.
   *
   * May be `{}`. Someone with no stated preference is not someone with a
   * neutral one — see `SoftPreferences`.
   */
  softPreferences: SoftPreferences;

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

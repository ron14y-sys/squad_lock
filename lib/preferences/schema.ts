import { z } from "zod";

/**
 * PUT /api/preferences request body (B3, spec §5.1) — the model boundary
 * for `lib/types/profile.ts`'s `PreferenceProfile`.
 *
 * `lib/types/index.ts` is explicit that it holds no Zod ("parsing untrusted
 * input belongs at the model boundary ... not in a file everything
 * imports") — this file is that boundary, one layer out. Each shape here
 * mirrors the real type in `lib/types/profile.ts` field for field, on
 * purpose: those types are what deterministic code (the hard-constraint
 * filter, the burden denominator) branches on, so validating anything
 * looser here would just move the guessing downstream instead of removing
 * it.
 *
 * Every top-level field is optional and independent: this is a partial
 * update (despite the PUT verb) over one row per user, so a client can save
 * one piece — e.g. just `toleranceKm` from a slider, or the four answers
 * from the this-or-that game — without resending the rest of the profile.
 */

const localWeekdaySchema = z.enum([
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
]);

/** `HH:MM`, 24-hour — mirrors `LocalTimeOfDay` in lib/types/primitives.ts. */
const localTimeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM, 24-hour.");

const localWindowSchema = z.object({
  weekdays: z.array(localWeekdaySchema),
  from: localTimeOfDaySchema,
  to: localTimeOfDaySchema,
});

const hardConstraintsSchema = z.object({
  dietary: z.array(z.string()),
  allergies: z.array(z.string()),
  unavailable: z.array(localWindowSchema),
});

const softPreferencesSchema = z.object({
  noiseLevel: z.enum(["lively", "quiet"]),
  activityStyle: z.enum(["outdoorsy", "cultural"]),
  budget: z.enum(["modest", "splurge"]),
  cuisine: z.enum(["familiar", "adventurous"]),
});

/** Neighbourhood granularity, never a street address (spec §5.4). */
const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const mobilityModeSchema = z.enum(["car", "transit", "walk"]);

const recurringMobilityRuleSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("mode_unavailable"),
    weekdays: z.array(localWeekdaySchema),
    mode: mobilityModeSchema,
    window: localWindowSchema.optional(),
  }),
  z.object({
    kind: z.literal("origin_override"),
    weekdays: z.array(localWeekdaySchema),
    originLabel: z.string().trim().min(1),
    origin: latLngSchema.optional(),
  }),
]);

export const preferenceProfileInputSchema = z
  .object({
    hardConstraints: hardConstraintsSchema,
    softPreferences: softPreferencesSchema,
    home: latLngSchema,
    homeNeighbourhood: z.string().trim().min(1),
    /** Kilometres, not the 1-5 scale the slider displays — spec §5.1. */
    toleranceKm: z.number().nonnegative(),
    recurringMobilityRules: z.array(recurringMobilityRuleSchema),
  })
  .partial()
  .strict();

export type PreferenceProfileInput = z.infer<
  typeof preferenceProfileInputSchema
>;

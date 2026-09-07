import { z } from "zod";

/**
 * POST /api/groups/[id]/meetings request body — initiating a meeting
 * (spec §3, §3.1, §5.3, issue #25).
 *
 * date/time/venue/occasion are independent and all optional — the
 * all-blank case is the default path, not a degraded one, so an empty
 * object must parse just as cleanly as a fully filled one. The one thing
 * this schema does enforce beyond individual field shape: a time with no
 * date schedules nothing (see PinnedWhen in lib/types/meeting.ts, and
 * meetingFromRow's own comment on why a bare time is discarded on the way
 * *out* of the database) — better to reject that at the door than accept it
 * and silently drop it later.
 */

const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD.");

/** `HH:MM`, 24-hour — mirrors LocalTimeOfDay in lib/types/primitives.ts. */
const localTimeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM, 24-hour.");

export const initiateMeetingSchema = z
  .object({
    date: localDateSchema,
    time: localTimeOfDaySchema,
    venue: z.string().trim().min(1),
    occasion: z.string().trim().min(1),
  })
  .partial()
  .strict()
  .refine((data) => data.time === undefined || data.date !== undefined, {
    message: "A time with no date schedules nothing — include a date too.",
    path: ["time"],
  });

export type InitiateMeetingInput = z.infer<typeof initiateMeetingSchema>;

/**
 * POST /api/meetings/[id]/respond request body — the four things a
 * participant can do to an open meeting (spec §3.2, issue #25).
 *
 * Three are responses (`Response.status`); the fourth, `amendment`, is
 * deliberately not one — see `ParticipantMeetingContext`'s own comment in
 * lib/types/meeting.ts. A discriminated union on `kind` keeps the four
 * shapes distinct rather than one object with a pile of optional fields
 * that only make sense in some combinations.
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

const localWindowSchema = z.object({
  weekdays: z.array(localWeekdaySchema),
  from: localTimeOfDaySchema,
  to: localTimeOfDaySchema,
});

/** Neighbourhood granularity, never a street address (spec §5.4). */
const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const mobilityModeSchema = z.enum(["car", "transit", "walk"]);

const mobilityWindowSchema = z.object({
  mode: mobilityModeSchema,
  available: z.boolean(),
  window: localWindowSchema,
});

const amendmentSchema = z
  .object({
    kind: z.literal("amendment"),
    origin: latLngSchema.optional(),
    originLabel: z.string().trim().min(1).optional(),
    mobilityWindows: z.array(mobilityWindowSchema).optional(),
    note: z.string().trim().min(1).optional(),
  })
  .strict();

export const respondToMeetingSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("approve") }).strict(),
    z.object({ kind: z.literal("cant_make_it") }).strict(),
    z
      .object({
        kind: z.literal("doesnt_suit"),
        reasonText: z.string().trim().min(1),
      })
      .strict(),
    amendmentSchema,
  ])
  .refine(
    (data) =>
      data.kind !== "amendment" ||
      data.origin !== undefined ||
      data.originLabel !== undefined ||
      (data.mobilityWindows !== undefined && data.mobilityWindows.length > 0) ||
      data.note !== undefined,
    {
      message:
        "An amendment needs at least one field — an empty one corrects nothing.",
      path: ["note"],
    }
  );

export type RespondToMeetingInput = z.infer<typeof respondToMeetingSchema>;

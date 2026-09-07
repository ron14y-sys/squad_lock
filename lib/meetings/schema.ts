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

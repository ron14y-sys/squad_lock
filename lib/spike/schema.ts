import { z } from "zod";

/**
 * The output shape of a matching run, as spec §4.1a and §4.1c define it:
 * a schema-validated ranked top 3, each option a (venue, datetime) pair with a
 * justification per participant and an internal record of what it trades away.
 *
 * This is the spike's approximation of A4's real schema. It exists here so the
 * measurement covers the output the real run has to produce — a call that
 * returns one line is not the call we are timing.
 */
export const matchOptionSchema = z.object({
  rank: z.number().int(),
  venue_id: z.string(),
  venue_name: z.string(),
  /** ISO 8601 local datetime, e.g. "2026-09-03T20:00". */
  datetime: z.string(),
  justifications: z.array(
    z.object({
      participant_id: z.string(),
      /** Written for that person, in their own terms. */
      reason: z.string(),
    })
  ),
  /** Internal only — never rendered to the person who bore the cost (§5.6). */
  traded_away: z.string(),
});

export const matchResultSchema = z.object({
  options: z.array(matchOptionSchema),
});

export type MatchResult = z.infer<typeof matchResultSchema>;

/**
 * The same shape as a plain JSON Schema, for the Gemini request's
 * `response_format.schema`.
 *
 * Written by hand rather than generated from the Zod schema on purpose: Zod
 * emits draft-2020-12 with `$schema`, numeric bounds and `additionalProperties`,
 * and the provider's schema dialect does not accept all of that. Zod stays on
 * the validation side, where it belongs — this is what goes over the wire.
 */
export const MATCH_RESULT_JSON_SCHEMA = {
  type: "object",
  properties: {
    options: {
      type: "array",
      items: {
        type: "object",
        properties: {
          rank: { type: "integer" },
          venue_id: { type: "string" },
          venue_name: { type: "string" },
          datetime: { type: "string" },
          justifications: {
            type: "array",
            items: {
              type: "object",
              properties: {
                participant_id: { type: "string" },
                reason: { type: "string" },
              },
              required: ["participant_id", "reason"],
            },
          },
          traded_away: { type: "string" },
        },
        required: [
          "rank",
          "venue_id",
          "venue_name",
          "datetime",
          "justifications",
          "traded_away",
        ],
      },
    },
  },
  required: ["options"],
} as const;

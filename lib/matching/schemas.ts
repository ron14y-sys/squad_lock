/**
 * A4 — the boundary between the model and the rest of the system.
 *
 * Everything the agent says arrives here as text and leaves as a typed object,
 * or it does not leave at all. [Spec §4.1a](../../docs/spec.md) is the rule:
 * "the agent's output is defined by a JSON Schema and enforced via structured
 * outputs. Free text appears only at the human boundary." A4's own acceptance
 * line puts it more bluntly — **no free-text parsing**.
 *
 * Two representations of one shape live here, and they are written twice on
 * purpose:
 *
 * - `MATCH_RESULT_JSON_SCHEMA` goes **over the wire**, in the request. It is
 *   plain JSON Schema because that is what the provider accepts.
 * - `matchResultSchema` (Zod) validates what **comes back**. It is stricter
 *   than the wire schema, because a provider's structured-output guarantee is
 *   a best effort and not a contract we get to rely on.
 *
 * Generating the first from the second was tried in the F2 spike and rejected:
 * Zod emits draft-2020-12 with `$schema`, numeric bounds and
 * `additionalProperties`, and the provider's dialect does not accept all of it
 * ([lib/spike/schema.ts](../spike/schema.ts)). So the wire schema stays hand
 * written and deliberately loose, and Zod does the real work on the way in.
 *
 * ## What the model is *not* asked for
 *
 * **Not the "ring ahead" warning.** An earlier draft (and the demo script that
 * preceded this file) had the model write an `unverified_note` saying what the
 * group should confirm by phone. That is a fact about a venue, and facts are
 * code's job — [spec §4.4](../../docs/spec.md): code narrows on what is true
 * or false, the model decides among what is valid. A2 already knows exactly
 * what could not be checked, per pair, in `ViablePair.unverified`. The model is
 * told **which pairs are verified**, so it can prefer them — that is a choice
 * — and `agent.ts` writes the warning itself from A2's findings. A model that
 * forgets the note cannot therefore cost anybody a phone call.
 *
 * **Not a distance, a sort, or an arithmetic result** (§4.1f). The burdens A3
 * computed are given to it; it never recomputes one.
 */

import { z } from "zod";

import type { TimeSlot } from "@/lib/types";

/* -------------------------------------------------------------------------
 * Identifying a slot on the wire
 * ---------------------------------------------------------------------- */

/**
 * How one time slot is named in the payload and in the answer.
 *
 * Two instants, so it is exact — no timezone, no formatting, no chance that
 * "Thursday 20:00" matches two different evenings. The model never parses it;
 * it copies the string back, and `agent.ts` looks the slot up again by it.
 *
 * **The one spelling of this key.** `distance.ts` and `constraints.ts` both
 * call it; [docs/decisions/leximin-fairness.md](../../docs/decisions/leximin-fairness.md)
 * asked for the extraction once there was a third caller. It lives here rather
 * than in `primitives.ts` because it is a wire format — a shape the model sees,
 * which is a different commitment from an internal key.
 */
export function slotId(slot: TimeSlot): string {
  return `${slot.start.getTime()}-${slot.end.getTime()}`;
}

/**
 * A venue and a slot as one string, for deduplicating options and indexing
 * burdens. `pairKey` takes the slot already named; `pairId` names it first.
 * Both exist so the `@` join is written once — an answer arrives carrying a
 * `slot_id` string, while everything internal carries the slot itself.
 */
export function pairKey(
  candidatePlaceId: string,
  slotIdString: string
): string {
  return `${candidatePlaceId}@${slotIdString}`;
}

export function pairId(candidatePlaceId: string, slot: TimeSlot): string {
  return pairKey(candidatePlaceId, slotId(slot));
}

/* -------------------------------------------------------------------------
 * What the model returns
 * ---------------------------------------------------------------------- */

/** Ranks 1, 2 and 3 (spec §4.1c). Only rank 1 is ever shown to anybody. */
export const MAX_OPTIONS = 3;

/**
 * The wire vocabulary is `snake_case` while the rest of the codebase is
 * `camelCase`, and that is not an oversight. It marks the boundary: a
 * `venue_id` is a string a model wrote, untrusted until `agent.ts` has looked
 * it up. A `placeId` is a value the system owns.
 */
const matchAgentOptionSchema = z.object({
  /** 1, 2 or 3. Checked for distinctness and coverage in `agent.ts`. */
  rank: z.number().int().min(1).max(MAX_OPTIONS),
  /** Must name a candidate that was offered — the `not_a_candidate` check. */
  venue_id: z.string().min(1),
  /** Must name a slot that was offered — the `slot_not_offered` check. */
  slot_id: z.string().min(1),
  /**
   * One entry per participant, addressed to that person.
   *
   * `min(1)` is all that is enforced here. **Full coverage — every confirmed
   * participant named on every option — is [A6](../../tasks/todo.md)**, which
   * owns both the check and the "5 of 6 is a failed run" test. A4 enforces the
   * half only an answer can get wrong: a justification addressed to somebody
   * who is not in this meeting at all.
   */
  justifications: z
    .array(
      z.object({
        participant_id: z.string().min(1),
        reason: z.string().min(1),
      })
    )
    .min(1),
  /**
   * What this option trades away and for whom (§4.1c).
   *
   * **Internal.** It feeds the timeline, the eval set and the report, and it is
   * never rendered to the person who bore the cost (§5.6). May be empty when
   * an option genuinely trades nothing away — an empty string is an answer,
   * and forcing prose into it would only invent a grievance.
   */
  traded_away: z.string(),
});

export const matchAgentResultSchema = z.object({
  options: z.array(matchAgentOptionSchema).min(1).max(MAX_OPTIONS),
});

export type MatchAgentOption = z.infer<typeof matchAgentOptionSchema>;

/**
 * The same shape for the request, in the provider's dialect.
 *
 * Deliberately looser than the Zod schema above — no bounds, no
 * `additionalProperties`. Its job is to steer the model into the right shape;
 * Zod's job is to refuse anything that still comes back wrong. A wire schema
 * that tries to be the validator fails at both, because a rejected request and
 * a rejected response need different errors in different places.
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
          slot_id: { type: "string" },
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
          "slot_id",
          "justifications",
          "traded_away",
        ],
      },
    },
  },
  required: ["options"],
} as const;

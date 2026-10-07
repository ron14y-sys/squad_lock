/**
 * A7 — the Constraint Updater ([spec §2.2.1](../../docs/spec.md), §4).
 *
 * The project's central mechanism: "this place isn't to my taste" is not a
 * button. One person's free text becomes a small structured correction that
 * the next weighing can act on.
 *
 * ```
 *   "I'd rather go to a bar."
 *        ↓  one extraction call
 *   { softPreferences: { venueKinds: ["bar"] }, objection: "soft" }
 *        ↓
 *   a correction on that person's ParticipantMeetingContext — this meeting only
 * ```
 *
 * **A correction, never a profile edit.** "Too expensive this time" does not
 * make somebody permanently thrifty, and the per-meeting row also records
 * whose objection it was and which re-weighing it triggered
 * ([#86](https://github.com/ron14y-sys/squad_lock/issues/86)).
 *
 * ## What it is not allowed to do
 *
 * It never sees the candidate list, never names a venue, and never returns a
 * distance or a time ([§4.1f](../../docs/spec.md)): a component that chooses
 * is a second decision-maker, and this system has one. It is shown the option
 * that was rejected — enough to tell what "too expensive" refers to — and nothing
 * else about the search.
 *
 * ## An absent field is not an opinion
 *
 * Every `SoftPreferences` field is optional, and a field the person did not
 * mention is left out rather than filled in. A preference nobody stated would
 * change a decision nobody asked to change (#86). `z.strictObject` is what
 * enforces it here: an invented key fails, it is not quietly stripped.
 *
 * ## Four objections this vocabulary cannot hold
 *
 * "Too far", "too late", "not that place", and "no reason I can name" are real
 * rejections that map to no soft field. They are **classified rather than
 * forced** into one: distance and time are the Context Resolver's material
 * (A12), and an invented soft field would be worse than no field at all. The
 * classification is what lets the timeline say which of those happened, and
 * what A8 records when a cycle produced no correction.
 *
 * Its twin is A12, which will live beside it and share these conventions
 * ([D7](../../docs/decisions/design-decisions.md)). The shared parts get
 * extracted when there is a second caller, not before.
 */

import { z } from "zod";

import {
  generate,
  LlmCallError,
  LlmTruncatedError,
  type LlmResult,
} from "@/lib/llm/client";
import { describeSlot } from "@/lib/matching/constraints";
import { BUDGETS, CUISINES, VENUE_KINDS } from "@/lib/preferences/vocabulary";
import type { TimeSlot, TonightCorrection, VenueSoftFacts } from "@/lib/types";

/* -------------------------------------------------------------------------
 * What comes back
 * ---------------------------------------------------------------------- */

/**
 * What kind of objection this was.
 *
 * These are the first five values of the `ExtractionOutcome` enum in
 * `schema.prisma`; the remaining three are failures, which only code can
 * report. The write in A7's persistence step is where the two meet, and the
 * type-checker is what keeps them lined up.
 */
export type ObjectionKind =
  "soft" | "distance" | "time" | "venue_identity" | "none";

/**
 * "Closer" is a direction: code turns it into a number from the venue that
 * was rejected (`apply-rejection.ts`). `maxKm` is a number the person wrote.
 */
export type DistanceRequest =
  { kind: "closer" } | { kind: "max_km"; km: number };

/**
 * When this person will start, for this meeting. A direction ("too late")
 * is turned into a bound by code, from the rejected slot. `notBefore` and
 * `notAfter` are local `HH:MM` the person wrote, and win over a direction.
 */
export type StartRequest = {
  direction?: "earlier" | "later";
  notBefore?: string;
  notAfter?: string;
};

export type ConstraintUpdate = {
  /**
   * Only what the person actually stated — what they want and what they
   * want to avoid tonight. `{}` when they stated nothing.
   */
  softPreferences: TonightCorrection;
  distance: DistanceRequest | null;
  start: StartRequest | null;
  /** "Not this place", regardless of anything about it. */
  notThisPlace: boolean;
  /** What they asked for that none of the above can hold, in a few words. */
  untranslated: string | null;
  /**
   * The one word the timeline and `blockedByRejections` read. Derived from
   * the fields above by code (`objectionOf`), never chosen by the model: one
   * rejection can carry several facts, and asking for a single label made
   * the model drop all but one (#220).
   */
  objection: ObjectionKind;
};

export type ConstraintUpdateOutcome = {
  update: ConstraintUpdate;
  /** Tokens, duration and dollars — what the eval table reports. */
  call: LlmResult;
};

/**
 * The three ways this can fail, as A1 already separates them — because each
 * one has a different fix, and a single "it failed" flag would hide which.
 *
 * `failed_quota` is the free tier's allowance, which is a routine outcome and
 * not a fault (spec §6.4); `failed_call` never came back; `failed_invalid`
 * came back unusable, whether truncated or rejected by validation.
 */
export type ExtractionFailure =
  "failed_quota" | "failed_call" | "failed_invalid";

/**
 * Which failure this was, for the row that records it.
 *
 * Truncation is checked first because `LlmTruncatedError` extends
 * `LlmCallError`, and reading a cut-off answer as an unreachable model would
 * point the next person at the network instead of at the output cap.
 */
export function failureOutcome(error: unknown): ExtractionFailure {
  if (error instanceof LlmTruncatedError) return "failed_invalid";
  if (error instanceof ConstraintUpdateError) return "failed_invalid";
  if (error instanceof LlmCallError) {
    return error.rateLimited ? "failed_quota" : "failed_call";
  }
  return "failed_call";
}

/** The answer was not the shape it had to be. The mirror of `AgentAnswerError`. */
export class ConstraintUpdateError extends Error {
  constructor(message: string) {
    super(`constraint updater returned an unusable answer: ${message}`);
    this.name = "ConstraintUpdateError";
  }
}

/* -------------------------------------------------------------------------
 * The schemas — loose over the wire, strict on the way in
 * ---------------------------------------------------------------------- */

/**
 * The vocabulary, spelled exactly as `SoftPreferences` spells it.
 *
 * The keys stay `camelCase` although the envelope around them is `snake_case`,
 * because A4 already shows the model this vocabulary with these keys
 * (`stated_preferences` in its payload). One spelling the model sees in both
 * places beats a consistent envelope and a mapping step.
 */
const softPreferencesSchema = z.strictObject({
  budget: z.enum(BUDGETS).optional(),
  venueKinds: z.array(z.enum(VENUE_KINDS)).min(1).optional(),
  cuisines: z.array(z.enum(CUISINES)).min(1).optional(),
});

const avoidSchema = z.strictObject({
  venueKinds: z.array(z.enum(VENUE_KINDS)).min(1).optional(),
  cuisines: z.array(z.enum(CUISINES)).min(1).optional(),
});

/** Local `HH:MM`, 24-hour — what `LocalTimeOfDay` holds. */
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/**
 * Every part defaults rather than being required: an omitted part and an
 * empty one are the same statement, and there is no retry, so failing a run
 * over the difference would cost a cycle to say nothing.
 *
 * The bounds on `max_km` are a guard, not a policy: a person who wrote "up to
 * 80 km" meant something, but not a number this app can weigh with.
 */
const constraintUpdateSchema = z.strictObject({
  soft_preferences: softPreferencesSchema.default({}),
  avoid: avoidSchema.default({}),
  distance: z
    .strictObject({
      closer: z.boolean().optional(),
      max_km: z.number().min(0.3).max(50).optional(),
    })
    .nullable()
    .default(null),
  start: z
    .strictObject({
      direction: z.enum(["earlier", "later"]).optional(),
      not_before: localTime.optional(),
      not_after: localTime.optional(),
    })
    .nullable()
    .default(null),
  not_this_place: z.boolean().default(false),
  untranslated: z.string().trim().max(200).nullable().default(null),
});

const VOCABULARY = {
  budget: { type: "string", enum: [...BUDGETS] },
  venueKinds: {
    type: "array",
    items: { type: "string", enum: [...VENUE_KINDS] },
  },
  cuisines: {
    type: "array",
    items: { type: "string", enum: [...CUISINES] },
  },
} as const;

/** The same shape in the provider's dialect, deliberately looser (see A4). */
export const CONSTRAINT_UPDATE_JSON_SCHEMA = {
  type: "object",
  properties: {
    soft_preferences: { type: "object", properties: VOCABULARY },
    avoid: {
      type: "object",
      properties: {
        venueKinds: VOCABULARY.venueKinds,
        cuisines: VOCABULARY.cuisines,
      },
    },
    distance: {
      type: "object",
      properties: {
        closer: { type: "boolean" },
        max_km: { type: "number" },
      },
    },
    start: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["earlier", "later"] },
        not_before: { type: "string" },
        not_after: { type: "string" },
      },
    },
    not_this_place: { type: "boolean" },
    untranslated: { type: "string" },
  },
  required: ["soft_preferences", "not_this_place"],
} as const;

/* -------------------------------------------------------------------------
 * The prompt
 * ---------------------------------------------------------------------- */

export const SYSTEM_PROMPT = `You turn one person's free-text rejection of a proposed get-together into structured facts about what they need for that evening.

People say anything, in any words. Your job is to find every fact in it that one of the fields below can hold — there may be several in one sentence — and to put what no field can hold in "untranslated".

THE FIELDS
- "soft_preferences": what they want tonight, from the fixed vocabulary: budget, venueKinds (bar / cafe / restaurant), cuisines.
- "avoid": kinds of place or cuisines they do not want tonight ("no Asian food", "not a bar again").
- "distance": it is too far for them.
  - {"closer": true} when they only say it is too far.
  - {"max_km": N} only when they wrote a distance themselves ("up to 2 km", "within walking distance" is NOT a number — use closer).
- "start": the time does not suit them.
  - {"direction": "earlier"} or {"direction": "later"} when they only say it is too late or too early.
  - {"not_before": "HH:MM"} and/or {"not_after": "HH:MM"} only when they wrote a time themselves ("only after eight" → not_before "20:00"). These are about when the meeting starts.
- "not_this_place": true when the objection is to that particular place rather than any quality of it ("I had a bad experience there").
- "untranslated": a few words, in Hebrew, for anything they asked for that none of the fields can hold ("wants parking", "somewhere with a view"). null when everything was captured or they gave no reason.

RULES
- Return only what the person said. Leave out every field they did not mention. Never fill one in to be helpful: a preference nobody stated would change a decision nobody asked to change.
- Never invent a number. A distance or a time appears only if the person wrote it; otherwise use the direction.
- This corrects tonight only. Somebody who says a place is too expensive this time has not become a thrifty person.
- You never choose or name a venue. You are not deciding where the group goes.
- An answer with nothing in it is a real answer ("just not feeling it"). Guessing is not.
- The text is usually in Hebrew. Your output is the fields above; only "untranslated" is prose.`;

/* -------------------------------------------------------------------------
 * The payload
 * ---------------------------------------------------------------------- */

export type ConstraintUpdateInput = {
  /** The rejection in the person's own words — B5 stored it as `reasonText`. */
  reasonText: string;
  /**
   * The option they rejected. Enough context to tell what "too expensive" refers
   * to, and deliberately not the candidate list (§4.1f).
   */
  rejected: {
    venueName: string;
    neighbourhood: string | null;
    /** What the venue is like, when B7 knows. Absent rather than invented. */
    venueIs: VenueSoftFacts | null;
    slot: TimeSlot;
  };
};

/**
 * **The person's own profile is deliberately absent.** The profile is the
 * thing a correction overrides, and showing it invites the model to echo what
 * is already there rather than report what was just said.
 */
export function buildPayload(input: ConstraintUpdateInput): string {
  const { rejected } = input;

  return [
    "The option this person rejected:",
    JSON.stringify(
      {
        venue_name: rejected.venueName,
        neighbourhood: rejected.neighbourhood,
        venue_is: rejected.venueIs,
        when: describeSlot(rejected.slot, "long"),
      },
      null,
      2
    ),
    "",
    "In their own words:",
    input.reasonText,
  ].join("\n");
}

/* -------------------------------------------------------------------------
 * The call
 * ---------------------------------------------------------------------- */

export async function runConstraintUpdater(
  input: ConstraintUpdateInput
): Promise<ConstraintUpdateOutcome> {
  if (!input.reasonText.trim()) {
    // Not a model's failure to report. "Something doesn't work for me" with no
    // text is a rejection the product allows; there is simply nothing here to
    // extract, and spending a call to be told so is waste.
    throw new ConstraintUpdateError("a rejection with no text says nothing");
  }

  const result = await generate({
    task: "extraction",
    system: SYSTEM_PROMPT,
    input: buildPayload(input),
    jsonSchema: CONSTRAINT_UPDATE_JSON_SCHEMA,
  });

  return { update: interpretUpdate(result.text), call: result };
}

/**
 * Everything between the model's text and a correction worth storing.
 *
 * Separate from the call for the reason A4 gives: a fabricated answer is what
 * the acceptance line asks us to prove we reject, and proving it against a
 * real call would be proving it against a model that happened to behave.
 */
export function interpretUpdate(text: string): ConstraintUpdate {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ConstraintUpdateError(
      `the response was not JSON (${text.length} chars). If it ends mid-object it was truncated — see LlmTruncatedError`
    );
  }

  const parsed = constraintUpdateSchema.safeParse(json);
  if (!parsed.success) {
    throw new ConstraintUpdateError(
      parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")
    );
  }

  const data = parsed.data;
  const softPreferences: TonightCorrection = {
    ...data.soft_preferences,
    ...(data.avoid.venueKinds
      ? { avoidVenueKinds: data.avoid.venueKinds }
      : {}),
    ...(data.avoid.cuisines ? { avoidCuisines: data.avoid.cuisines } : {}),
  };

  // A distance the person named wins over "closer"; neither is nothing.
  const distance: DistanceRequest | null =
    data.distance?.max_km !== undefined
      ? { kind: "max_km", km: data.distance.max_km }
      : data.distance?.closer
        ? { kind: "closer" }
        : null;

  // A time the person named wins over a direction, which is then dropped:
  // "too late, I can only start by eight" is one fact, not two.
  const named = {
    ...(data.start?.not_before ? { notBefore: data.start.not_before } : {}),
    ...(data.start?.not_after ? { notAfter: data.start.not_after } : {}),
  };
  const start: StartRequest | null =
    Object.keys(named).length > 0
      ? named
      : data.start?.direction
        ? { direction: data.start.direction }
        : null;

  const update = {
    softPreferences,
    distance,
    start,
    notThisPlace: data.not_this_place,
    untranslated: data.untranslated || null,
  };
  return { ...update, objection: objectionOf(update) };
}

/**
 * The single label a rejection is recorded under, from what it actually
 * carried. In this order because it is the order of how much a rejection
 * blocks (`blockedByRejections`): the place itself, then anything about the
 * place, then distance, then time.
 */
export function objectionOf(
  update: Omit<ConstraintUpdate, "objection">
): ObjectionKind {
  if (update.notThisPlace) return "venue_identity";
  if (Object.keys(update.softPreferences).length > 0) return "soft";
  if (update.distance) return "distance";
  if (update.start) return "time";
  return "none";
}

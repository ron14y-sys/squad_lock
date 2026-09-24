/**
 * A7 — the Constraint Updater ([spec §2.2.1](../../docs/spec.md), §4).
 *
 * The project's central mechanism: "this place isn't to my taste" is not a
 * button. One person's free text becomes a small structured correction that
 * the next weighing can act on.
 *
 * ```
 *   "It's too loud for me, I want somewhere quieter."
 *        ↓  one extraction call
 *   { softPreferences: { noiseLevel: "quiet" }, objection: "soft" }
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
 * that was rejected — enough to tell what "too loud" refers to — and nothing
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
import type { SoftPreferences, TimeSlot, VenueSoftFacts } from "@/lib/types";

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

export type ConstraintUpdate = {
  /** Only what the person actually stated. `{}` when they stated nothing. */
  softPreferences: SoftPreferences;
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

const OBJECTIONS = [
  "soft",
  "distance",
  "time",
  "venue_identity",
  "none",
] as const;

/**
 * The vocabulary, spelled exactly as `SoftPreferences` spells it.
 *
 * The keys stay `camelCase` although the envelope around them is `snake_case`,
 * because A4 already shows the model this vocabulary with these keys
 * (`stated_preferences` in its payload). One spelling the model sees in both
 * places beats a consistent envelope and a mapping step.
 */
const softPreferencesSchema = z.strictObject({
  noiseLevel: z.enum(["lively", "quiet"]).optional(),
  activityStyle: z.enum(["outdoorsy", "cultural"]).optional(),
  budget: z.enum(["modest", "splurge"]).optional(),
  cuisine: z.enum(["familiar", "adventurous"]).optional(),
});

/**
 * `soft_preferences` defaults rather than being required: an omitted object
 * and an empty one are the same statement, and there is no retry, so failing a
 * run over the difference would cost a cycle to say nothing.
 */
const constraintUpdateSchema = z.strictObject({
  soft_preferences: softPreferencesSchema.default({}),
  objection: z.enum(OBJECTIONS),
});

/** The same shape in the provider's dialect, deliberately looser (see A4). */
export const CONSTRAINT_UPDATE_JSON_SCHEMA = {
  type: "object",
  properties: {
    soft_preferences: {
      type: "object",
      properties: {
        noiseLevel: { type: "string", enum: ["lively", "quiet"] },
        activityStyle: { type: "string", enum: ["outdoorsy", "cultural"] },
        budget: { type: "string", enum: ["modest", "splurge"] },
        cuisine: { type: "string", enum: ["familiar", "adventurous"] },
      },
    },
    objection: { type: "string", enum: [...OBJECTIONS] },
  },
  required: ["soft_preferences", "objection"],
} as const;

/* -------------------------------------------------------------------------
 * The prompt
 * ---------------------------------------------------------------------- */

export const SYSTEM_PROMPT = `You turn one person's free-text rejection of a proposed get-together into a small structured correction for that evening.

WHAT YOU RETURN
- "soft_preferences": only the fields this person actually stated, from the fixed vocabulary in the schema.
- "objection": what kind of objection this was.

RULES
- Return only what the person said. Leave out every field they did not mention. Never fill one in to be helpful: a preference nobody stated would change a decision nobody asked to change.
- This corrects tonight only. Somebody who says a place is too expensive this time has not become a thrifty person.
- You never choose or name a venue, never return a distance, and never return a time. You are not deciding where the group goes.
- Set "objection" to "soft" exactly when you return at least one field, and leave "soft_preferences" empty in every other case:
  - "distance" — the objection is about how far it is.
  - "time" — the objection is about the hour or the day.
  - "venue_identity" — the objection is to that particular place rather than to any quality of it ("I had a bad experience there").
  - "none" — nothing in the text maps to the vocabulary at all ("just not feeling it").
- Returning "none" is a real answer and a useful one. Guessing is not.
- The text is usually in Hebrew. Your output is the fixed values above, never prose.`;

/* -------------------------------------------------------------------------
 * The payload
 * ---------------------------------------------------------------------- */

export type ConstraintUpdateInput = {
  /** The rejection in the person's own words — B5 stored it as `reasonText`. */
  reasonText: string;
  /**
   * The option they rejected. Enough context to tell what "too loud" refers
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

  const softPreferences = parsed.data.soft_preferences;
  const { objection } = parsed.data;
  const stated = Object.keys(softPreferences).length > 0;

  // The two halves of one answer, so they have to agree. A correction filed
  // under "distance" would be applied by A8 and explained by the timeline as
  // something the person never said — and "soft" with nothing in it records a
  // cycle as answered when nothing was captured.
  if (stated !== (objection === "soft")) {
    throw new ConstraintUpdateError(
      stated
        ? `objection "${objection}" came with stated preferences (${Object.keys(softPreferences).join(", ")})`
        : `objection "soft" came with no stated preference`
    );
  }

  return { softPreferences, objection };
}

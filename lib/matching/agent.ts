/**
 * A4 — the Group Matching Agent (spec §4.1a–e).
 *
 * **One call.** Every profile, every viable `(venue, slot)` pair and every
 * burden A3 computed go into a single request, and a ranked top 3 comes back.
 * Not six agents negotiating, not a loop — [spec §4.2](../../docs/spec.md)
 * retired that design on purpose: six profiles and twenty venues fit in one
 * context, and splitting them makes each agent reason from a partial view.
 *
 * This is the only place in the system where a model **decides** anything.
 * Everything around it is deterministic, and the division is
 * [§4.4](../../docs/spec.md)'s:
 *
 * ```
 *   A2 filterPairs        which pairs are legal at all        code
 *   A3 scoreCandidates    how heavily each one falls on whom  code
 *   ────────────────────────────────────────────────────────────────
 *   A4 this file          which of the legal ones is best     the model
 *   ────────────────────────────────────────────────────────────────
 *   A2 assertChosenPair…  is the answer still legal           code
 * ```
 *
 * The model is handed the arithmetic rather than asked for it (§4.1f). It
 * never computes a distance, never sorts the candidate set, and cannot pick a
 * pair it was not shown.
 *
 * ## What comes out
 *
 * A `MatchRunDraft` — the run and its three options, ready to persist, with no
 * database ids on it yet. Writing it is [`lib/db/match-run.ts`](../db/match-run.ts);
 * keeping the two apart is what lets every check in this file be tested
 * without a database.
 *
 * ## The three failure modes, and why they are three different errors
 *
 * | Error                  | Means                                    | The fix                             |
 * | ---------------------- | ---------------------------------------- | ----------------------------------- |
 * | `LlmTruncatedError`    | The answer was cut off (A1)              | Raise the cap or lower the thinking |
 * | `AgentAnswerError`     | The answer was the wrong shape           | The schema or the prompt            |
 * | `HardConstraintError`  | The answer broke somebody's constraint   | A failed run. Never a proposal      |
 *
 * F2 lost an afternoon to the first two being indistinguishable, so A1 already
 * separates them. The third is A2's, and it throws for the reason
 * [docs/decisions/hard-constraints.md](../../docs/decisions/hard-constraints.md)
 * gives: a guard whose result can be ignored is a comment.
 */

import { generate, type LlmResult } from "@/lib/llm/client";
import {
  assertChosenPairAllowed,
  describeSlot,
  type ConstraintInput,
  type UnverifiedFact,
  type ViablePair,
} from "./constraints";
import type { CandidateScore } from "./distance";
import {
  MATCH_RESULT_JSON_SCHEMA,
  MAX_OPTIONS,
  matchAgentResultSchema,
  pairId,
  pairKey,
  slotId,
  type MatchAgentOption,
} from "./schemas";
import type {
  Candidate,
  MatchOption,
  MatchRun,
  Participant,
  VenueSoftFacts,
} from "@/lib/types";

/* -------------------------------------------------------------------------
 * What a run produces, before it has been written down
 * ---------------------------------------------------------------------- */

/**
 * A `MatchOption` without the ids the database assigns.
 *
 * `unverifiedNote` is the one field that has no counterpart on the wire: the
 * model does not write it, this file does, from A2's findings. See
 * `describeUnverified`.
 */
export type MatchOptionDraft = Omit<
  MatchOption,
  "id" | "matchRunId" | "createdAt"
> & {
  /**
   * What A2 could not check about the chosen pair. Empty when it was fully
   * verified.
   *
   * **The fact, not the sentence.** The "ring ahead" line
   * [hard-constraints.md](../../docs/decisions/hard-constraints.md) requires is
   * rendered from this by `unverifiedNote` in
   * [`lib/format/hebrew-labels.ts`](../format/hebrew-labels.ts) — the app is
   * Hebrew and RTL, so the prose belongs in the formatting layer and only the
   * structured fact is persisted.
   */
  unverified: UnverifiedFact[];
};

/** A `MatchRun` and its options, as A4 produces them and B-track writes them. */
export type MatchRunDraft = Omit<MatchRun, "id" | "createdAt"> & {
  options: MatchOptionDraft[];
};

export type MatchAgentOutcome = {
  draft: MatchRunDraft;
  /**
   * Tokens, duration and dollars for this run — persisted alongside it — plus
   * the raw JSON in `call.text`, which is what a failed eval wants to see.
   */
  call: LlmResult;
};

/**
 * The answer was not the shape it had to be.
 *
 * Distinct from `LlmTruncatedError` (the answer was cut off) and from
 * `HardConstraintError` (the answer was well formed and illegal), because the
 * three have three different fixes.
 */
export class AgentAnswerError extends Error {
  constructor(message: string) {
    super(`matching agent returned an unusable answer: ${message}`);
    this.name = "AgentAnswerError";
  }
}

/* -------------------------------------------------------------------------
 * Input
 * ---------------------------------------------------------------------- */

export type MatchAgentInput = {
  meetingId: string;
  /** 1, 2 or 3. The cap and the `stuck` state that follows it are A8's. */
  cycleNumber: number;
  /** The initiator's free-text note, if she wrote one ("Maya's birthday"). */
  occasion?: string | null;
  /** Confirmed participants. Every one of them must be justified to (A6). */
  participants: Participant[];
  /** The pool the agent may choose from. Anything not here cannot be picked. */
  candidates: Candidate[];
  /** A2's survivors. The agent sees these and nothing else. */
  viable: ViablePair[];
  /** A3's scores, already ranked. Advice to the model, not an instruction. */
  ranked: CandidateScore[];
  /** Passed through to the post-check, exactly as A2's filter received it. */
  venueFacts?: ConstraintInput["venueFacts"];
  /**
   * What each venue is like, on the four axes a person answers — keyed by
   * `placeId`, and passed **beside** the candidate rather than inside it
   * ([#86](https://github.com/ron14y-sys/squad_lock/issues/86)). B7 fills it
   * in; until then it is simply absent, and the agent is told nothing about
   * atmosphere rather than being told something invented.
   */
  venueSoftFacts?: Record<string, VenueSoftFacts>;
  /** Streams the answer as it arrives — the progress C5/C6 render (§4.1e). */
  onText?: (chunk: string, soFar: string) => void;
};

/* -------------------------------------------------------------------------
 * The prompt
 * ---------------------------------------------------------------------- */

/**
 * The standing instruction. Stable across every call, which is what makes it
 * the part worth caching later.
 *
 * Four of these rules are not stylistic — each one is a decision recorded
 * somewhere else, and deleting a line silently un-decides it:
 *
 * - **"Do not second-guess the filter"** — §4.1b. The agent is not the place
 *   where an allergy is weighed.
 * - **"An absent preference is not a vote"** — [#86](https://github.com/ron14y-sys/squad_lock/issues/86)
 *   question 5. Nothing deterministic reads `softPreferences` at all, so this
 *   obligation is the prompt's alone. Scenario `05` is the test: one person
 *   stated a preference and three did not, and those three must not become
 *   three silent votes for the better-rated venue.
 * - **"Prefer verified pairs"** — [hard-constraints.md](../../docs/decisions/hard-constraints.md).
 *   The preference is the model's; the resulting warning is not (see
 *   `describeUnverified`).
 * - **"Never tell a person what an option cost them"** — §5.6. Naming a
 *   constraint is a fact; naming a comparison manufactures a grievance that
 *   did not exist.
 */
export const SYSTEM_PROMPT = `You are the Group Matching Agent for a system that arranges get-togethers among friends.

You are given every participant, and every (venue, slot) pair that is allowed. Choose the best three and rank them.

WHAT HAS ALREADY BEEN DECIDED FOR YOU
- Every pair listed has already passed a deterministic hard-constraint filter: opening hours, dietary requirements, allergies, calendars and mobility. Do not second-guess it, and never choose anything that is not in the list.
- Every pair carries the burden it places on each person, computed before you were called. 1.0 is exactly as far as that person said they were willing to travel; 1.4 is half again as far. Do not recompute or re-sort these numbers.
- The pairs are listed in fairness order: the one whose worst-off participant is least badly off comes first.

HOW TO CHOOSE
- Fairness order is advice, not an instruction. Every pair listed is a valid answer, and a better-suited venue further down may well be the right one — but passing over the fairest option trades someone's journey for something else, so name that trade in "traded_away".
- Strongly prefer a pair marked "verified": true. A pair marked false carries something we could not check. Choose one only when the verified options are clearly worse.
- A participant who stated no opinion on something has no opinion on it. That is a real state, not a neutral vote and not agreement with the majority. Never count a silence as a preference, never let one decide between two options, and never write a justification that describes a silence as a choice someone made.
- Your three options must be three different (venue, slot) pairs.

HOW TO WRITE THE JUSTIFICATIONS
- Write one for EVERY participant on EVERY option, addressed to that person, in their own terms. Never omit anyone, and never justify to somebody who is not in the list.
- Name a constraint, never a comparison. "A twenty-minute ride for you, and they take the allergy seriously" is right. "Twenty minutes worse for you than the fairest option" is forbidden — the person never sees what an option cost them.
- "traded_away" is the opposite: it is internal, nobody is shown it, and it is where the honest cost of the choice belongs. Say what was given up and for whom. Leave it empty only when the option genuinely gives nothing up.`;

/* -------------------------------------------------------------------------
 * The payload
 * ---------------------------------------------------------------------- */

/**
 * The per-call input: who is coming, and what they may be offered.
 *
 * Every pair carries its burdens keyed **by participant name**, because the
 * model writes prose about people and an opaque id in the arithmetic makes the
 * two halves hard for it to line up. The ids it has to hand *back* stay ids.
 */
export function buildPayload(input: MatchAgentInput): string {
  const {
    participants,
    viable,
    ranked,
    candidates,
    venueSoftFacts,
    occasion,
    cycleNumber,
  } = input;

  const candidateById = new Map(candidates.map((c) => [c.placeId, c]));

  const people = participants.map((person) => ({
    id: person.userId,
    name: person.name,
    neighbourhood: person.profile.homeNeighbourhood,
    tolerance_km: person.profile.toleranceKm,
    // Absent fields are absent here too. Filling them with "no preference"
    // would hand the model a value to reason about where there is none (#86).
    stated_preferences: person.profile.softPreferences,
  }));

  // A3's order, applied to A2's survivors. `Infinity` parks anything the
  // scorer never saw at the end rather than dropping it: an unscored pair is
  // still a legal one, and losing it here would narrow the choice silently.
  const rankOf = new Map(
    ranked.map((score, i) => [score.candidate.placeId, i])
  );

  const burdenByCell = new Map(
    ranked.flatMap((score) =>
      score.burdens.map(
        (burden) =>
          [
            `${pairId(burden.candidatePlaceId, burden.slot)}|${burden.participantId}`,
            burden.value,
          ] as const
      )
    )
  );

  const pairs = [...viable]
    .sort(
      (a, b) =>
        (rankOf.get(a.candidatePlaceId) ?? Infinity) -
        (rankOf.get(b.candidatePlaceId) ?? Infinity)
    )
    .map((pair) => {
      const candidate = candidateById.get(pair.candidatePlaceId);
      const key = pairId(pair.candidatePlaceId, pair.slot);
      return {
        venue_id: pair.candidatePlaceId,
        venue_name: candidate?.name ?? pair.candidatePlaceId,
        neighbourhood: candidate?.neighbourhood ?? null,
        rating: candidate?.rating ?? null,
        venue_is: venueSoftFacts?.[pair.candidatePlaceId] ?? null,
        slot_id: slotId(pair.slot),
        when: describeSlot(pair.slot, "long"),
        verified: pair.unverified.length === 0,
        burden_by_person: Object.fromEntries(
          participants.map((person) => [
            person.name,
            burdenByCell.get(`${key}|${person.userId}`)?.toFixed(2) ?? null,
          ])
        ),
      };
    });

  return [
    occasion ? `Occasion: ${occasion}` : "Occasion: a get-together.",
    `Weighing round ${cycleNumber}.`,
    "",
    "Participants:",
    JSON.stringify(people, null, 2),
    "",
    "Allowed (venue, slot) pairs — every one already passes every hard constraint, listed fairest first:",
    JSON.stringify(pairs, null, 2),
    "",
    `Return the ranked top ${Math.min(MAX_OPTIONS, pairs.length)}, choosing only from the pairs above.`,
    // Slot ids are unreadable on purpose, and a model that "tidies" one breaks
    // the lookup. Saying so costs a line and saves a failed run.
    "Copy venue_id and slot_id back exactly as they are written above.",
  ].join("\n");
}

/* -------------------------------------------------------------------------
 * The run
 * ---------------------------------------------------------------------- */

/**
 * One weighing: build the payload, make the call, and refuse the answer unless
 * it survives every check.
 *
 * Nothing is written to a database here. The caller persists the draft — see
 * [`lib/db/match-run.ts`](../db/match-run.ts).
 */
export async function runMatchingAgent(
  input: MatchAgentInput
): Promise<MatchAgentOutcome> {
  if (input.participants.length === 0) {
    throw new AgentAnswerError("a run needs at least one participant");
  }
  if (input.viable.length === 0) {
    // Not this file's failure to report. An empty viable set is `stuck` and
    // the group has to be told why (spec §5.4, B6) — silently asking a model
    // to choose from nothing would turn that into a fabricated answer.
    throw new AgentAnswerError(
      "no viable (venue, slot) pair survived the filter — that is `stuck`, not a matching run"
    );
  }

  const result: LlmResult = await generate({
    task: "matching",
    system: SYSTEM_PROMPT,
    input: buildPayload(input),
    jsonSchema: MATCH_RESULT_JSON_SCHEMA,
    onText: input.onText,
  });

  const draft = interpretAnswer(result.text, input);

  return { draft, call: result };
}

/**
 * Everything between the model's text and a run worth persisting.
 *
 * Separate from `runMatchingAgent` so that every check below is testable
 * against a hand-written answer, with no key, no quota and no network. A
 * fabricated answer is exactly what the acceptance line asks us to prove we
 * reject, and proving it against a real call would be proving it against a
 * model that happened to behave.
 */
export function interpretAnswer(
  text: string,
  input: MatchAgentInput
): MatchRunDraft {
  const options = validateOptions(parse(text), input);

  // The slots the agent was actually shown — one entry per distinct slot in
  // `viable`, which is the list the payload was built from.
  //
  // **Deliberately not a second list.** An earlier version advertised
  // `viable`'s slots in the prompt and looked the answer up in a separate
  // `input.slots`. They held the same values, so nothing failed — but nothing
  // made them agree either, and B6 is the change that separates them: once a
  // slot is trimmed to a venue's opening hours, the trimmed window is in
  // `viable` and not in the group's raw availability. Every option would then
  // be rejected as "a slot that was not offered", blaming the model for a time
  // this file put in the prompt itself.
  const slotById = new Map(
    input.viable.map((pair) => [slotId(pair.slot), pair.slot])
  );

  const constraintInput: ConstraintInput = {
    candidates: input.candidates,
    participants: input.participants,
    slots: [...slotById.values()],
    venueFacts: input.venueFacts,
  };
  const candidateById = new Map(input.candidates.map((c) => [c.placeId, c]));
  const unverifiedByPair = new Map(
    input.viable.map((pair) => [
      pairId(pair.candidatePlaceId, pair.slot),
      pair.unverified,
    ])
  );

  const drafts = options.map((option) => {
    const slot = slotById.get(option.slot_id);
    if (!slot) {
      // A slot id the model invented. The post-check would catch a *wrong*
      // slot; it cannot catch one that does not resolve to a time at all.
      throw new AgentAnswerError(
        `rank ${option.rank} names slot "${option.slot_id}", which was not offered`
      );
    }

    // A2, on the real answer. Fabricated venue, unoffered slot, a venue shut
    // at that hour, somebody's allergy — all of it, again, after the fact.
    assertChosenPairAllowed(
      { candidatePlaceId: option.venue_id, slot },
      constraintInput
    );

    const candidate = candidateById.get(option.venue_id) as Candidate;

    return {
      rank: option.rank,
      venue: {
        placeId: candidate.placeId,
        name: candidate.name,
        address: candidate.address,
        location: candidate.location,
      },
      proposedDatetime: slot.start,
      proposedEnd: slot.end,
      participantJustifications: Object.fromEntries(
        option.justifications.map((j) => [j.participant_id, j.reason])
      ),
      tradeoffs: { tradedAway: option.traded_away },
      unverified: unverifiedByPair.get(pairId(option.venue_id, slot)) ?? [],
    } satisfies MatchOptionDraft;
  });

  return {
    meetingId: input.meetingId,
    cycleNumber: input.cycleNumber,
    shortlist: input.ranked,
    options: drafts,
  };
}

/** JSON first, then the schema. Both failures are the same kind of failure. */
function parse(text: string): MatchAgentOption[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new AgentAnswerError(
      `the response was not JSON (${text.length} chars). If it ends mid-object it was truncated — see LlmTruncatedError`
    );
  }

  const parsed = matchAgentResultSchema.safeParse(json);
  if (!parsed.success) {
    throw new AgentAnswerError(
      parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")
    );
  }

  return [...parsed.data.options].sort((a, b) => a.rank - b.rank);
}

/**
 * The checks the schema cannot express, because each one is about the answer
 * against **this** run's input rather than about the shape of the answer.
 */
function validateOptions(
  options: MatchAgentOption[],
  input: MatchAgentInput
): MatchAgentOption[] {
  // Three options, unless there were not three pairs to choose from. Demanding
  // three from a shortlist of two would fail a run whose answer was correct.
  const expected = Math.min(MAX_OPTIONS, distinctPairs(input.viable));
  if (options.length !== expected) {
    throw new AgentAnswerError(
      `expected ${expected} ranked option(s) for ${input.viable.length} allowed pair(s), got ${options.length}`
    );
  }

  // `parse` sorted by rank, so this one check covers a repeat as well as a
  // gap: [1, 1] fails at index 1 exactly as [1, 3] does.
  const ranks = options.map((option) => option.rank);
  if (ranks.some((rank, i) => rank !== i + 1)) {
    throw new AgentAnswerError(
      `ranks must run 1..${expected} with no repeats, got [${ranks.join(", ")}]`
    );
  }

  // Three ways of saying the same evening is not a ranked set of three. It
  // also breaks A8b, which carries ranks 2 and 3 into the next cycle.
  const seen = new Set<string>();
  for (const option of options) {
    const key = pairKey(option.venue_id, option.slot_id);
    if (seen.has(key)) {
      throw new AgentAnswerError(`(${key}) is ranked more than once`);
    }
    seen.add(key);
  }

  // A justification addressed to somebody who is not in this meeting. The
  // mirror case — a participant left out — is A6's, along with its test.
  const roster = new Set(input.participants.map((person) => person.userId));
  for (const option of options) {
    for (const justification of option.justifications) {
      if (!roster.has(justification.participant_id)) {
        throw new AgentAnswerError(
          `rank ${option.rank} justifies to "${justification.participant_id}", who is not in this meeting`
        );
      }
    }
    const ids = option.justifications.map((j) => j.participant_id);
    if (new Set(ids).size !== ids.length) {
      throw new AgentAnswerError(
        `rank ${option.rank} justifies to the same person twice`
      );
    }
  }

  return options;
}

/** Pairs, not rows: the same venue at two hours is two choices, not one. */
function distinctPairs(viable: ViablePair[]): number {
  return new Set(viable.map((pair) => pairId(pair.candidatePlaceId, pair.slot)))
    .size;
}

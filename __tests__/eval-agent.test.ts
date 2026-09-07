import { describe, expect, it } from "vitest";

import {
  loadScenario,
  loadScenarios,
  needsTrim,
  scenarioAgentInput,
} from "@/evals/adapter";
import { interpretAnswer, runMatchingAgent } from "@/lib/matching/agent";
import { slotId } from "@/lib/matching/schemas";

/**
 * A4 end to end on a real eval scenario.
 *
 * Two halves, and the split is about quota rather than tidiness:
 *
 * - **The deterministic half always runs.** The adapter, A2 and A3 over every
 *   scenario in `evals/scenarios/`. No key, no network, no cost — so `npm test`
 *   covers it on every commit.
 * - **The live half is opt-in**, behind `EVAL_LIVE=1`. `gemini-3.6-flash`
 *   allows **20 requests per day** on the free tier (spec §6.4), so a real call
 *   on every test run would exhaust a day's budget before lunch and make the
 *   suite slow and flaky at the same time. Run it deliberately:
 *
 *   ```
 *   EVAL_LIVE=1 npx vitest run __tests__/eval-agent.test.ts
 *   ```
 *
 * The whole-pipeline check that does not need a model is what actually guards
 * A4's acceptance line day to day; the live run is what proves the acceptance
 * line was ever true against a real model.
 */

const LIVE = process.env.EVAL_LIVE === "1";

/**
 * F2 measured a worst case of 207.8s on a thinking model, and the client's own
 * deadline is 290s. This sits just outside that, so a run that overruns is
 * reported by the client — which knows it was a timeout — rather than by
 * vitest killing the test with no explanation.
 */
const LIVE_TIMEOUT_MS = 300_000;

/**
 * The scenario A4 runs against: nothing narrows its window, so B6's absence
 * changes no answer here. `needsTrim` identifies the ones where it does.
 *
 * Loaded once and shared by both describes below — the deterministic checks
 * and the live run assert against the same input, which is the point.
 */
const SCENARIO = loadScenario("hard-constraint-trap");
const INPUT = scenarioAgentInput(SCENARIO);

describe("every scenario, through the real filter and the real scorer", () => {
  for (const scenario of loadScenarios()) {
    const untrimmable = needsTrim(scenario);

    it(`${scenario.id} produces a usable run input`, () => {
      const input = scenarioAgentInput(scenario);

      expect(input.participants.length).toBeGreaterThan(0);
      expect(input.candidates.length).toBeGreaterThan(0);
      expect(input.slots.length).toBeGreaterThan(0);

      // Every survivor was scored, and every score covers every person. This
      // holds whether or not the scenario needs trimming, so it is asserted
      // either way — skipping it would hide a real A3 regression.
      for (const score of input.ranked) {
        expect(score.leximin).toHaveLength(input.participants.length);
      }

      // Without B6 the meeting cannot shorten to fit a venue, so a scenario
      // whose answer is a narrowed window loses the very pair that should
      // win. Asserting a pass here would assert that a missing stage does not
      // matter — and the green suite would report B6's absence as a model
      // failure once A5 scores it.
      if (untrimmable) return;

      expect(input.viable.length).toBeGreaterThan(0);
    });
  }
});

describe("the hard-constraint trap, before any model is involved", () => {
  it("drops the higher-rated venue that breaks Dana's kosher requirement", () => {
    // §4.1b: this happens in code, before the agent sees a candidate. Toto is
    // closer and rated 4.8 against 4.3, and none of that is ever compared.
    const offered = INPUT.viable.map((pair) => pair.candidatePlaceId);

    expect(offered).not.toContain("place-01-toto");
    expect(offered).toContain("place-01-container");
  });

  it("leaves the expected answer as the only pair the agent can choose", () => {
    expect(new Set(INPUT.viable.map((p) => p.candidatePlaceId)).size).toBe(1);
    expect(
      INPUT.candidates.find(
        (c) => c.placeId === INPUT.viable[0].candidatePlaceId
      )?.name
    ).toBe(SCENARIO.expected.venue);
  });

  it("cannot be talked into the trap by a model that picks it anyway", () => {
    // The post-check, on the fabricated answer the filter was there to
    // prevent. A model that returns Toto gets a failed run, not a proposal
    // sent to somebody who cannot eat there.
    const answer = JSON.stringify({
      options: [
        {
          rank: 1,
          venue_id: "place-01-toto",
          slot_id: slotId(INPUT.slots[0]),
          justifications: INPUT.participants.map((person) => ({
            participant_id: person.userId,
            reason: "Highest rated and closest to all three of you.",
          })),
          traded_away: "",
        },
      ],
    });

    expect(() => interpretAnswer(answer, INPUT)).toThrow(/kosher/i);
  });
});

describe.skipIf(!LIVE)("the live run", () => {
  it(
    "reaches the scenario's agreed answer, with a justification for everyone",
    async () => {
      const { draft, call } = await runMatchingAgent(INPUT);

      const top = draft.options.find((option) => option.rank === 1);
      expect(top?.venue.name).toBe(SCENARIO.expected.venue);

      // A6 owns the enforcement of this; A4 checks that a real model actually
      // manages it, because a rule nothing has ever satisfied is a guess.
      for (const person of INPUT.participants) {
        expect(top?.participantJustifications[person.userId]).toBeTruthy();
      }

      // The cost columns the migration added have something to hold.
      expect(call.usage.inputTokens).toBeGreaterThan(0);
      console.info(
        `[eval] ${SCENARIO.id}: ${top?.venue.name} in ${call.ms}ms, ${call.usage.thoughtTokens} thought tokens`
      );
    },
    LIVE_TIMEOUT_MS
  );
});

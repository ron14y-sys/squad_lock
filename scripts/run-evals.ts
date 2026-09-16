/**
 * The eval runner — A4's engine over the F5 scenarios, scored against the
 * answers the three of us agreed on.
 *
 *   npm run eval                     # every scenario that can be scored today
 *   npm run eval -- 01 04            # just those, by id or by number
 *   npm run eval -- --replay <dir>   # re-judge a recorded sweep. No key, no quota
 *   npm run eval -- --include-blocked
 *
 * **Quota is the scarcest thing here.** `gemini-3.6-flash` allows 20 requests
 * a day on the free tier (spec §6.4), and four scenarios can be scored today,
 * so a full sweep is four of them. Everything else this file does — judging,
 * counting violations, the table — is built and debugged in `--replay`, which
 * costs nothing.
 *
 * **Not a CI gate.** It spends real requests, and a model's judgement is not a
 * thing to block a pull request on. Spec §12's "≥ 80% of scenarios" is a
 * target measured deliberately. The one invariant that *is* hard — zero
 * hard-constraint violations — is what the exit code enforces.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  loadScenarios,
  scenarioAgentInput,
  type Scenario,
} from "@/evals/adapter";
import { blockedReason, classify, judge, type Verdict } from "@/evals/judge";
import {
  interpretAnswer,
  runMatchingAgent,
  type MatchAgentInput,
  type MatchRunDraft,
} from "@/lib/matching/agent";
import {
  checkChosenPair,
  type ConstraintInput,
} from "@/lib/matching/constraints";
import { isOverloaded, isRateLimited, retryDelayMs } from "@/lib/llm/client";
import { describeTotal, totalCost, type Cost } from "@/lib/llm/cost";

/* -------------------------------------------------------------------------
 * Arguments
 * ---------------------------------------------------------------------- */

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const value = (name: string) => {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
};
const filters = argv.filter(
  (arg) => !arg.startsWith("--") && arg !== value("--replay")
);

const replayDir = value("--replay");
const includeBlocked = flag("--include-blocked");

/* -------------------------------------------------------------------------
 * One row of the table
 * ---------------------------------------------------------------------- */

type Row = {
  scenario: Scenario;
  state: "pass" | "fail" | "error" | "blocked" | "deferred";
  detail: string;
  cost?: Cost;
  ms?: number;
  violations: number;
};

/**
 * The post-check, run again by the runner rather than trusted.
 *
 * `runMatchingAgent` already calls `assertChosenPairAllowed` on all three
 * options — but a check that only ever runs inside the thing it is checking is
 * not a check, and this is the one column spec §12 says must be zero. It costs
 * nothing: A2 is pure.
 */
function countViolations(input: MatchAgentInput, draft: MatchRunDraft): number {
  const slots = new Map(
    input.viable.map((pair) => [
      `${pair.slot.start.toISOString()}/${pair.slot.end.toISOString()}`,
      pair.slot,
    ])
  );
  const constraintInput: ConstraintInput = {
    candidates: input.candidates,
    participants: input.participants,
    slots: [...slots.values()],
    venueFacts: input.venueFacts,
  };

  return draft.options.reduce(
    (found, option) =>
      found +
      checkChosenPair(
        {
          // Null cannot be a candidate, so A2 reports it as one — which is
          // the right answer, not a crash.
          candidatePlaceId: option.venue.placeId ?? "",
          slot: { start: option.proposedDatetime, end: option.proposedEnd },
        },
        constraintInput
      ).length,
    0
  );
}

/* -------------------------------------------------------------------------
 * The sweep
 * ---------------------------------------------------------------------- */

/** Set on a rate limit, which ends the sweep — a partial table beats a crash. */
let stopped: string | null = null;

/**
 * Milliseconds between calls. The free tier limits requests per *minute* as
 * well as per day (spec §6.4), and a sweep that fires five in a row trips the
 * first without going near the second — which is how the second run lost three
 * scenarios to "high demand" before hitting a real quota wall.
 */
const PACE_MS = Number(process.env.EVAL_PACE_MS ?? 20_000);

/** How many times a transient refusal is worth retrying before giving up. */
const RETRIES = 3;

/**
 * The longest wait worth sitting through.
 *
 * A rate limit comes in two sizes and the API distinguishes them for us: the
 * per-*minute* window says "retry in 16s" and is simply the pace this tier
 * runs at, while the per-*day* cap either gives no delay or gives one measured
 * in hours. Waiting out the first is how a free-tier sweep completes at all;
 * waiting out the second means blocking until tomorrow, so the sweep stops and
 * says so instead.
 */
const MAX_WAIT_MS = 90_000;

const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const outDir =
  replayDir ??
  join("evals", "runs", new Date().toISOString().replace(/[:.]/g, "-"));

async function answerFor(
  scenario: Scenario,
  input: MatchAgentInput
): Promise<{ draft: MatchRunDraft; cost?: Cost; ms?: number }> {
  const file = join(outDir, `${scenario.id}.json`);

  if (replayDir) {
    const record = JSON.parse(readFileSync(file, "utf8"));
    return { draft: interpretAnswer(record.text, input), ...record.call };
  }

  const { draft, call } = await runMatchingAgent(input);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    file,
    JSON.stringify(
      { text: call.text, call: { cost: call.cost, ms: call.ms } },
      null,
      2
    )
  );
  return { draft, cost: call.cost, ms: call.ms };
}

/**
 * Retry a transient refusal, never a quota.
 *
 * "The model is busy" clears in seconds; "you are out of allowance" does not,
 * and retrying it burns the very window it is asking us to wait for. So an
 * overload is waited out and tried again, and a rate limit is raised at once
 * for `run` to end the sweep on.
 */
async function withRetries<T>(attempt: () => Promise<T>): Promise<T> {
  for (let tries = 0; ; tries += 1) {
    try {
      return await attempt();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const busy = isOverloaded(message);
      const asked = retryDelayMs(message);

      // An overload clears on its own; a short rate-limit delay is the tier's
      // own pace, and the API has just told us what it is. Anything else — a
      // daily cap, or a limit with no delay attached — is not a wait, it is a
      // stop, and `run` reports it as one.
      const delay = busy
        ? (asked ?? (tries + 1) * PACE_MS)
        : isRateLimited(message) && asked !== null && asked <= MAX_WAIT_MS
          ? asked + 2_000
          : null;

      if (delay === null || tries >= RETRIES) throw error;

      console.log(
        `  … ${busy ? "busy" : "pacing"}, waiting ${Math.round(delay / 1000)}s (attempt ${tries + 2} of ${RETRIES + 1})`
      );
      await pause(delay);
    }
  }
}

async function run(scenario: Scenario): Promise<Row> {
  const classification = classify(scenario);
  if (classification !== "scored" && !includeBlocked) {
    return {
      scenario,
      state: classification,
      detail: blockedReason(scenario),
      violations: 0,
    };
  }

  // A recording only holds what that sweep ran. Saying so beats an ENOENT
  // that reads like a broken runner.
  if (replayDir && !existsSync(join(replayDir, `${scenario.id}.json`))) {
    return {
      scenario,
      state: "blocked",
      detail: "not in this recording",
      violations: 0,
    };
  }

  const input = scenarioAgentInput(scenario);

  try {
    const { draft, cost, ms } = await withRetries(() =>
      answerFor(scenario, input)
    );
    const verdict: Verdict = judge(scenario, draft);
    return {
      scenario,
      state: verdict.pass ? "pass" : "fail",
      detail: verdict.reason ?? draft.options[0].venue.name,
      cost,
      ms,
      violations: countViolations(input, draft),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // A hard-constraint failure is a violation *and* a failed run: the engine
    // refused to return an illegal answer, which is the guard rail working.
    const violations =
      error instanceof Error && error.name === "HardConstraintError" ? 1 : 0;

    if (isRateLimited(message)) {
      const asked = retryDelayMs(message);
      stopped = `rate limited${asked ? ` — the API asked for ${Math.round(asked / 1000)}s` : ""}`;
    }
    return {
      scenario,
      state: "error",
      detail: message.split("\n")[0],
      violations,
    };
  }
}

/* -------------------------------------------------------------------------
 * The table
 * ---------------------------------------------------------------------- */

const VERDICT: Record<Row["state"], string> = {
  pass: "PASS",
  fail: "FAIL",
  error: "ERROR",
  blocked: "BLOCKED",
  deferred: "DEFERRED",
};

function print(rows: Row[]): void {
  const width = Math.max(...rows.map((row) => row.scenario.id.length));
  const dash = (text?: string) => text ?? "—";

  console.log(
    `\n${"scenario".padEnd(width)}  ${"verdict".padEnd(8)}  ${"cost".padEnd(10)}  ${"dur".padEnd(7)}  cycles  viol  detail`
  );
  for (const row of rows) {
    console.log(
      [
        row.scenario.id.padEnd(width),
        VERDICT[row.state].padEnd(8),
        dash(
          row.cost ? describeTotal(totalCost([row.cost])) : undefined
        ).padEnd(10),
        dash(
          row.ms === undefined ? undefined : `${(row.ms / 1000).toFixed(1)}s`
        ).padEnd(7),
        // Always 1, and printed rather than omitted: spec §12 asks for the
        // column, and it stays 1 until A8 spends a cycle.
        dash(row.ms !== undefined ? "1" : undefined).padEnd(6),
        String(row.violations).padEnd(4),
        row.detail,
      ].join("  ")
    );
  }

  // Scored means an answer came back and was judged. A call that never
  // returned one was not measured, and folding it into the denominator would
  // report the model as wrong when the API had simply said "later".
  const scored = rows.filter((row) => row.cost !== undefined);
  const unreached = rows.filter(
    (row) => row.state === "error" && row.cost === undefined
  ).length;
  const passed = rows.filter((row) => row.state === "pass").length;
  const rate = scored.length ? Math.round((passed / scored.length) * 100) : 0;
  const violations = rows.reduce((sum, row) => sum + row.violations, 0);
  const costs = rows.flatMap((row) => (row.cost ? [row.cost] : []));
  const ms = rows.reduce((sum, row) => sum + (row.ms ?? 0), 0);

  const aside = (state: Row["state"], label: string) => {
    const count = rows.filter((row) => row.state === state).length;
    return count ? ` · ${count} ${label}` : "";
  };

  // The denominator is scored scenarios, and it says so. Dividing by eight
  // when four cannot run would be a number that means nothing.
  console.log(
    `\n${scored.length} scored · ${passed} passed (${rate}%)` +
      aside("blocked", replayDir ? "not scored" : "blocked (A12)") +
      aside("deferred", "deferred (A7/A8)") +
      (unreached ? ` · ${unreached} no answer` : "")
  );
  console.log(
    `${costs.length ? describeTotal(totalCost(costs)) : "no cost"} · ${(ms / 1000).toFixed(1)}s · ${violations} hard-constraint violations\n`
  );
  if (!replayDir && costs.length)
    console.log(`answers recorded in ${outDir}\n`);
  if (stopped) console.log(`sweep stopped: ${stopped}\n`);
}

/* -------------------------------------------------------------------------
 * Main
 * ---------------------------------------------------------------------- */

async function main() {
  const chosen = loadScenarios().filter(
    (scenario, index) =>
      filters.length === 0 ||
      filters.some(
        (filter) =>
          scenario.id.includes(filter) ||
          String(index + 1).padStart(2, "0") === filter
      )
  );
  if (chosen.length === 0)
    throw new Error(`no scenario matched ${filters.join(", ")}`);

  const rows: Row[] = [];
  for (const scenario of chosen) {
    if (stopped) {
      rows.push({
        scenario,
        state: "blocked",
        detail: "not run",
        violations: 0,
      });
      continue;
    }
    const row = await run(scenario);
    rows.push(row);
    // Only a real call needs pacing, and only if another one follows.
    if (!replayDir && row.ms !== undefined && !stopped) await pause(PACE_MS);
  }

  print(rows);

  const violations = rows.reduce((sum, row) => sum + row.violations, 0);
  const errored = rows.some((row) => row.state === "error");
  process.exit(violations > 0 || errored ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

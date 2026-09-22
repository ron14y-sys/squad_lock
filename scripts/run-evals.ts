/**
 * The eval runner — A4's engine over the F5 scenarios, scored against the
 * answers the three of us agreed on.
 *
 *   npm run eval                     # every scenario that can be scored today
 *   npm run eval -- 01 04            # just those, by id or by number
 *   npm run eval -- --replay <dir>   # re-judge a recorded sweep. No key, no quota
 *   npm run eval -- --include-blocked
 *   npm run eval -- --followup       # and A7's corrected cycle, in its own table
 *   npm run eval -- --followup 07    # just that one: 1 extraction + 1 matching call
 *
 * **Quota is the scarcest thing here.** `gemini-3.6-flash` allows 20 requests
 * a day on the free tier (spec §6.4), and five scenarios can be scored today,
 * so a full sweep is five of them. Everything else — judging (`evals/judge.ts`),
 * counting violations and totals (`evals/sweep.ts`), the table — is tested
 * without a key and debugged in `--replay`, which costs nothing.
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
  rejectionCases,
  scenarioAgentInput,
  scenarioFollowupInput,
  type Scenario,
} from "@/evals/adapter";
import { blockedReason, classify, judge, type Verdict } from "@/evals/judge";
import { runConstraintUpdater } from "@/lib/extraction/constraint-updater";
import {
  countViolations,
  distinctJustifications,
  exitCode,
  summarize,
  type Row,
} from "@/evals/sweep";
import {
  interpretAnswer,
  runMatchingAgent,
  type MatchAgentInput,
  type MatchRunDraft,
} from "@/lib/matching/agent";
import { isRateLimited, retryDelayMs } from "@/lib/llm/client";
import { pause, withRetries } from "@/evals/retry";
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
/** A7 + A4, one cycle later. See `followUp` below. */
const followup = flag("--followup");
/** Skip the live extraction and feed the agreed constraint instead. */
const agreed = flag("--agreed");

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
    const { draft, cost, ms } = await withRetries(
      () => answerFor(scenario, input),
      {
        paceMs: PACE_MS,
      }
    );
    const verdict: Verdict = judge(scenario, draft);
    return {
      scenario,
      state: verdict.pass ? "pass" : "fail",
      detail: verdict.reason ?? draft.options[0].venue.name,
      cost,
      ms,
      violations: countViolations(input, draft),
      distinct: distinctJustifications(draft),
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
 * A7 + A8's shadow — one corrected cycle
 * ---------------------------------------------------------------------- */

/**
 * The rejection loop, minus the loop: extract the constraint from what
 * somebody wrote, hand it back to the agent with the rejected venue gone, and
 * ask whether the follow-up is the proposal we agreed on.
 *
 * **This is the only thing that shows success criterion 4 before A8 exists** —
 * "a free-text rejection produces a materially different next proposal that
 * visibly addresses the stated reason". There is no cap here, nothing is
 * persisted, and no cycle is spent; A8 owns all three, and this goes away when
 * it lands.
 *
 * **Its own table, deliberately.** `07` and `08` stay `deferred` in the sweep
 * above, because "the follow-up is right" is a claim about a loop that does
 * not exist yet, and spec §12.5's pass rate may only carry the claim the
 * product can actually make today.
 *
 * The constraint comes from a **live** A7 call, so what is measured is the
 * chain rather than half of it. When that call cannot be made — the free tier
 * is a shared resource and this model has whole afternoons of 503 — `--agreed`
 * feeds the constraint the fixture already states, which measures the agent
 * alone and still produces a number. Attribution is free either way: the
 * constraint table in `npm run eval:constraints` is what says whether A7 was
 * right.
 */
type FollowupRow = {
  id: string;
  from: "live" | "agreed" | "—";
  state: "pass" | "fail" | "error";
  detail: string;
  cost?: Cost;
  ms?: number;
};

async function followUp(scenario: Scenario): Promise<FollowupRow> {
  const one = rejectionCases().find(
    (rejection) => rejection.id === scenario.id
  );
  if (!one || !scenario.expectedConstraint) {
    return {
      id: scenario.id,
      from: "—",
      state: "error",
      detail: "no rejection",
    };
  }

  let correction = scenario.expectedConstraint.softPreferences;
  let from: FollowupRow["from"] = "agreed";
  let ms = 0;

  if (!agreed) {
    try {
      const { update, call } = await withRetries(
        () =>
          runConstraintUpdater({
            reasonText: one.text,
            rejected: one.rejected,
          }),
        { paceMs: PACE_MS }
      );
      correction = update.softPreferences;
      from = "live";
      ms += call.ms;
    } catch (error) {
      // Not a failure of the follow-up. The chain could not be run, so the
      // agreed constraint stands in and the table says so.
      console.log(
        `  … ${scenario.id}: extraction unavailable (${(error instanceof Error ? error.message : String(error)).split("\n")[0]}), using the agreed constraint`
      );
    }
  }

  const input = scenarioFollowupInput(scenario, correction, one.text);

  try {
    const { draft, call } = await withRetries(() => runMatchingAgent(input), {
      paceMs: PACE_MS,
    });
    const verdict = judge(scenario, draft);
    return {
      id: scenario.id,
      from,
      state: verdict.pass ? "pass" : "fail",
      detail: verdict.reason ?? draft.options[0].venue.name,
      cost: call.cost,
      ms: ms + call.ms,
    };
  } catch (error) {
    return {
      id: scenario.id,
      from,
      state: "error",
      detail: (error instanceof Error ? error.message : String(error)).split(
        "\n"
      )[0],
      ms,
    };
  }
}

function printFollowups(rows: FollowupRow[]): void {
  const width = Math.max(...rows.map((row) => row.id.length));
  console.log(
    `\nafter one rejection\n${"scenario".padEnd(width)}  ${"from".padEnd(6)}  ${"verdict".padEnd(7)}  ${"cost".padEnd(10)}  ${"dur".padEnd(7)}  detail`
  );
  for (const row of rows) {
    console.log(
      [
        row.id.padEnd(width),
        row.from.padEnd(6),
        row.state.toUpperCase().padEnd(7),
        (row.cost ? describeTotal(totalCost([row.cost])) : "—").padEnd(10),
        (row.ms ? `${(row.ms / 1000).toFixed(1)}s` : "—").padEnd(7),
        row.detail,
      ].join("  ")
    );
  }
  console.log(
    `\n${rows.filter((row) => row.state === "pass").length} of ${rows.length} answered the objection\n`
  );
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
    `\n${"scenario".padEnd(width)}  ${"verdict".padEnd(8)}  ${"cost".padEnd(10)}  ${"dur".padEnd(7)}  cycles  viol  just  detail`
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
        dash(row.distinct).padEnd(4),
        row.detail,
      ].join("  ")
    );
  }

  const total = summarize(rows);
  const aside = (count: number, label: string) =>
    count ? ` · ${count} ${label}` : "";

  // The denominator is scored scenarios, and it says so. Dividing by eight
  // when three cannot run would be a number that means nothing.
  console.log(
    `\n${total.scored} scored · ${total.passed} passed (${total.rate}%)` +
      aside(total.blocked, replayDir ? "not scored" : "blocked (A12)") +
      aside(total.deferred, "deferred (A7/A8)") +
      aside(total.unreached, "no answer")
  );
  console.log(
    `${total.cost ? describeTotal(total.cost) : "no cost"} · ${(total.ms / 1000).toFixed(1)}s · ${total.violations} hard-constraint violations\n`
  );
  if (!replayDir && total.cost) console.log(`answers recorded in ${outDir}\n`);
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

  if (followup) {
    const withRejections = chosen.filter(
      (scenario) => scenario.rejection && scenario.expectedConstraint
    );
    const followups: FollowupRow[] = [];
    for (const scenario of withRejections) {
      if (followups.length) await pause(PACE_MS);
      followups.push(await followUp(scenario));
    }
    if (followups.length) printFollowups(followups);
  }

  process.exit(exitCode(rows));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/**
 * The eval runner — A4's engine over the F5 scenarios, scored against the
 * answers the three of us agreed on.
 *
 *   npm run eval                     # every scenario that can be scored today
 *   npm run eval -- 01 04            # just those, by id or by number
 *   npm run eval -- --replay <dir>   # re-judge a recorded sweep. No key, no quota
 *   npm run eval -- --include-blocked
 *   npm run eval -- --followup       # and A7's corrected cycle, in its own table
 *   npm run eval -- --followup 08    # just that one: 1 extraction + 1 matching call
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
  scenarioAgentInput,
  type Scenario,
} from "@/evals/adapter";
import { blockedReason, classify, judge, type Verdict } from "@/evals/judge";
import { rejectAndRerun, seedScenario } from "@/evals/loop";
import { getPrisma } from "@/lib/db/client";
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
 * The rejection loop, for real: seed the scenario as a meeting, let somebody
 * reject the proposal it says was on the table, and ask whether what the loop
 * proposes next is what we agreed on.
 *
 * This is success criterion 4 — "a free-text rejection produces a materially
 * different next proposal that visibly addresses the stated reason" — measured
 * through the code that ships. `respondToMeeting` records the rejection, A7
 * extracts from it, `blockedByRejections` blocks the venue, `mergeContexts`
 * carries the correction, `runCycle` re-runs, and the row it persists is what
 * gets judged. Nothing is imitated; `evals/loop.ts` says what is injected and
 * why.
 *
 * **Its own table, still.** The follow-up is a second cycle with its own cost,
 * its own duration and its own failure modes, and averaging it into the sweep
 * would hide which of the two a number came from.
 *
 * The constraint comes from a **live** A7 call, so what is measured is the
 * chain rather than half of it. When that call cannot be made — the free tier
 * is a shared resource and this model has whole afternoons of 503 — `--agreed`
 * writes the constraint the fixture already states straight onto the context
 * row, which measures the loop and the agent alone and still produces a
 * number. Attribution is free either way: the constraint table in
 * `npm run eval:constraints` is what says whether A7 was right.
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
  if (!scenario.rejection || !scenario.expectedConstraint) {
    return {
      id: scenario.id,
      from: "—",
      state: "error",
      detail: "no rejection",
    };
  }

  let seeded;
  try {
    seeded = await seedScenario(scenario);
  } catch (error) {
    return {
      id: scenario.id,
      from: "—",
      state: "error",
      detail: (error instanceof Error ? error.message : String(error)).split(
        "\n"
      )[0],
    };
  }

  const started = Date.now();
  try {
    const run = await rejectAndRerun(seeded, scenario, {
      correction: agreed
        ? scenario.expectedConstraint.softPreferences
        : undefined,
    });
    const ms = Date.now() - started;

    if (!run) {
      // `runCycle` never throws — a fault leaves the meeting in `weighing`
      // and logs one line. So "no second run" is the whole diagnosis here,
      // and the line above it is the detail.
      return {
        id: scenario.id,
        from: agreed ? "agreed" : "live",
        state: "error",
        detail: "no second cycle was written — see the [a8] line above",
        ms,
      };
    }

    const verdict = judge(scenario, run);
    return {
      id: scenario.id,
      from: agreed ? "agreed" : "live",
      state: verdict.pass ? "pass" : "fail",
      detail: verdict.reason ?? run.options[0].venue.name,
      cost: await costOfLatestRun(seeded.meetingId),
      ms,
    };
  } catch (error) {
    return {
      id: scenario.id,
      from: agreed ? "agreed" : "live",
      state: "error",
      detail: (error instanceof Error ? error.message : String(error)).split(
        "\n"
      )[0],
      ms: Date.now() - started,
    };
  } finally {
    await seeded.cleanup();
  }
}

/**
 * What the follow-up cost, read off the run rather than returned by it.
 *
 * `runCycle` persists the call's cost on the `MatchRun` — which is why A4 put
 * those columns there — so the number in this table is the same one §6.4's
 * cost-per-decision figure will be totalled from, and not a second
 * measurement of it.
 */
async function costOfLatestRun(meetingId: string): Promise<Cost | undefined> {
  const run = await getPrisma().matchRun.findFirst({
    where: { meetingId },
    orderBy: { cycleNumber: "desc" },
  });
  if (!run?.model || run.costUsd === null) return undefined;

  return {
    model: run.model,
    usd: Number(run.costUsd),
    basis: (run.costBasis ?? "unknown") as Cost["basis"],
  };
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
      aside(
        total.blocked,
        replayDir ? "not scored" : "blocked (A12 not in v1)"
      ) +
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

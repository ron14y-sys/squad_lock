/**
 * A7's own measurement — the Constraint Updater over every rejection we have
 * an agreed answer for.
 *
 *   npm run eval:constraints                    # every case, 3 runs each
 *   npm run eval:constraints -- vague distance  # just those, by id
 *   npm run eval:constraints -- --runs 1        # one run each, when quota is tight
 *   npm run eval:constraints -- "רחוק לי מדי"   # one sentence of your own
 *
 * **A separate table from `npm run eval`, deliberately.** "The right
 * constraint came out" and "the right proposal came out" are two different
 * claims, and only the second is the pass rate spec §12.5 asks for. Mixing
 * them would inflate the number that matters with one that does not.
 *
 * It also answers A5's open question about stability, which A5 itself could
 * not afford: this model does not think at `low` and its daily allowance is
 * well above the matching model's 20, so every case runs three times and the
 * table says how often the answer was the same one.
 *
 * The free-sentence form is the one to reach for when you want to see the
 * thing work rather than measure it.
 */

import { rejectionCases, type RejectionCase } from "@/evals/adapter";
import { judgeConstraint } from "@/evals/judge";
import {
  runConstraintUpdater,
  type ConstraintUpdate,
} from "@/lib/extraction/constraint-updater";
import { describeTotal, totalCost, type Cost } from "@/lib/llm/cost";
import { pause, withRetries } from "@/evals/retry";

const argv = process.argv.slice(2);
const value = (name: string) => {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
};

const runs = Number(value("--runs") ?? 3);
const cases = rejectionCases();
const known = new Set(cases.map((one) => one.id));
const args = argv.filter(
  (arg) => !arg.startsWith("--") && arg !== value("--runs")
);
const ids = args.filter((arg) => known.has(arg));
/** Anything that is not one of our ids is a sentence somebody wants tried. */
const sentence = args.filter((arg) => !known.has(arg)).join(" ");

/**
 * Between calls. The free tier limits requests per minute as well as per day
 * (spec §6.4), and this sweep fires three calls per case — which trips the
 * first limit long before it goes near the second.
 */
const PACE_MS = Number(process.env.EVAL_PACE_MS ?? 4_000);

const shape = (update: ConstraintUpdate) =>
  `${update.objection}${Object.keys(update.softPreferences).length ? ` ${JSON.stringify(update.softPreferences)}` : ""}`;

type Row = {
  id: string;
  source: string;
  state: "pass" | "flaky" | "fail" | "error";
  agree: string;
  detail: string;
  costs: Cost[];
  ms: number;
};

async function measure(one: RejectionCase): Promise<Row> {
  const answers: string[] = [];
  const costs: Cost[] = [];
  let passes = 0;
  let ms = 0;
  let firstFailure: string | null = null;

  for (let run = 0; run < runs; run += 1) {
    if (run > 0) await pause(PACE_MS);
    try {
      const { update, call } = await withRetries(
        () =>
          runConstraintUpdater({
            reasonText: one.text,
            rejected: one.rejected,
          }),
        { paceMs: PACE_MS }
      );
      costs.push(call.cost);
      ms += call.ms;
      answers.push(shape(update));

      const verdict = judgeConstraint(one.expected, update);
      if (verdict.pass) passes += 1;
      else firstFailure ??= verdict.reason ?? "wrong";
    } catch (error) {
      return {
        id: one.id,
        source: one.source,
        state: "error",
        agree: "—",
        detail: (error instanceof Error ? error.message : String(error)).split(
          "\n"
        )[0],
        costs,
        ms,
      };
    }
  }

  // How often the model said the same thing, whatever that thing was —
  // stability, which is a different question from being right.
  const tally = new Map<string, number>();
  for (const answer of answers) tally.set(answer, (tally.get(answer) ?? 0) + 1);
  const agreed = Math.max(...tally.values());

  return {
    id: one.id,
    source: one.source,
    state: passes === runs ? "pass" : passes ? "flaky" : "fail",
    agree: `${agreed}/${runs}`,
    detail: passes === runs ? (answers[0] ?? "") : (firstFailure ?? ""),
    costs,
    ms: Math.round(ms / runs),
  };
}

async function tryOne(text: string): Promise<void> {
  const stand = cases.find((one) => one.source === "fixture");
  const { update, call } = await runConstraintUpdater({
    reasonText: text,
    rejected: stand!.rejected,
  });

  console.log(`\n"${text}"`);
  console.log(`  objection        ${update.objection}`);
  console.log(`  softPreferences  ${JSON.stringify(update.softPreferences)}\n`);
  console.log(
    `  ${describeTotal(totalCost([call.cost]))} · ${(call.ms / 1000).toFixed(1)}s\n`
  );
}

async function main(): Promise<void> {
  if (sentence) {
    await tryOne(sentence);
    return;
  }

  const selected = ids.length
    ? cases.filter((one) => ids.includes(one.id))
    : cases;

  console.log(
    `${selected.length} rejection(s), ${runs} run(s) each — ${selected.length * runs} calls\n`
  );

  const rows: Row[] = [];
  for (const one of selected) {
    if (rows.length) await pause(PACE_MS);
    rows.push(await measure(one));
  }

  const width = Math.max(...rows.map((row) => row.id.length));
  console.log(
    `${"case".padEnd(width)}  ${"source".padEnd(8)}  ${"verdict".padEnd(7)}  ${"agree".padEnd(5)}  ${"dur".padEnd(6)}  detail`
  );
  for (const row of rows) {
    console.log(
      [
        row.id.padEnd(width),
        row.source.padEnd(8),
        row.state.toUpperCase().padEnd(7),
        row.agree.padEnd(5),
        `${(row.ms / 1000).toFixed(1)}s`.padEnd(6),
        row.detail,
      ].join("  ")
    );
  }

  const passed = rows.filter((row) => row.state === "pass").length;
  const costs = rows.flatMap((row) => row.costs);
  console.log(
    `\n${rows.length} measured · ${passed} passed (${Math.round((passed / rows.length) * 100)}%)`
  );
  console.log(
    `${costs.length ? describeTotal(totalCost(costs)) : "no cost"} over ${costs.length} calls\n`
  );

  // Non-zero on a call that never answered, never on a wrong answer — the
  // same rule `npm run eval` follows.
  if (rows.some((row) => row.state === "error")) process.exitCode = 1;
}

void main();

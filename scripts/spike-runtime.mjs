#!/usr/bin/env node
/**
 * F2 runner — calls the spike route repeatedly and prints a markdown table.
 *
 * One run is an anecdote: LLM latency varies enough that a single number is not
 * evidence. This takes the median and the worst of several runs per
 * (model, thinking level) pair, and it is the worst that has to fit the timeout.
 *
 *   npm run spike:runtime                          # local, 5 runs each
 *   npm run spike:runtime -- --runs=3
 *   npm run spike:runtime -- --url=https://squadlock.vercel.app
 *
 * Runs are spaced out, because the Gemini free tier allows only 5 requests per
 * minute per model — one every 12 seconds. The gap defaults to 20s for headroom;
 * change it with --gap=<seconds>.
 *
 * A quota error is not a measurement. When one comes back, this waits out the
 * window the API names and takes the run again, rather than recording a 0.4s
 * "run" that never reached a model.
 */

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=");
    return [key, value ?? "true"];
  })
);

const BASE_URL = args.url ?? "http://localhost:3000";
const RUNS = Number(args.runs ?? 5);
const MODELS = (args.models ?? "gemini-3.5-flash-lite,gemini-3.6-flash").split(
  ","
);
const LEVELS = (args.levels ?? "low,high").split(",");
const GAP_MS = Number(args.gap ?? 20) * 1000;
/** How many times to re-take a run that failed for a reason that is not latency. */
const MAX_ATTEMPTS = Number(args.attempts ?? 4);

/** Vercel Hobby: 300s default and maximum, with fluid compute. */
const TIMEOUT_SECONDS = 300;
/** Success criterion 6 in the spec — a target, not a wall. */
const TARGET_SECONDS = 20;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function callOnce(model, thinkingLevel) {
  const response = await fetch(`${BASE_URL}/api/spike/match`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, thinkingLevel }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status}: ${body.slice(0, 200)}`);
  }

  // NDJSON: progress lines, then one final line carrying the result.
  const text = await response.text();
  const lines = text.trim().split("\n").filter(Boolean);
  for (const line of lines.reverse()) {
    const parsed = JSON.parse(line);
    if (parsed.result) return parsed.result;
  }
  throw new Error("stream ended without a result line");
}

/** The delay the API itself asked for, if it named one. */
function retryDelayMs(message = "") {
  const match = message.match(/retry in ([\d.]+)s/i);
  return match ? Math.ceil(Number(match[1]) * 1000) : null;
}

/** A failure that says nothing about how long a run takes. */
function isTransient(run) {
  if (!run) return true; // the request itself died
  return (
    run.rateLimited ||
    /internal error|unavailable|high demand|overloaded|\b50\d\b|terminated/i.test(
      run.error ?? ""
    )
  );
}

/**
 * Takes one measurement, re-taking it if the failure was a quota or a transient
 * server error. Only a run that actually reached the model counts.
 */
async function measure(model, level) {
  let last = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      last = await callOnce(model, level);
    } catch (error) {
      last = null;
      console.log(`\n    request failed: ${error.message}`);
    }

    if (last?.ok) return last;
    if (!isTransient(last)) return last; // a real failure — report it as is

    if (attempt === MAX_ATTEMPTS) break;
    const waitMs = retryDelayMs(last?.error) ?? 0;
    const backoffMs = Math.max(waitMs + 3000, 15000);
    const reason = last?.rateLimited ? "quota" : "server error";
    process.stdout.write(
      `\n    ${reason} — waiting ${Math.round(backoffMs / 1000)}s, then retaking… `
    );
    await sleep(backoffMs);
  }
  return last;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

const rows = [];

for (const model of MODELS) {
  for (const level of LEVELS) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      process.stdout.write(`  ${model} / ${level} — run ${i + 1}/${RUNS}… `);
      const run = await measure(model, level);
      if (run) {
        runs.push(run);
        const seconds = (run.msTotal / 1000).toFixed(1);
        console.log(
          run.ok ? `${seconds}s` : `${seconds}s (FAILED: ${run.error})`
        );
      } else {
        console.log("gave up after repeated transient failures");
      }
      if (i < RUNS - 1) await sleep(GAP_MS);
    }

    const good = runs.filter((run) => run.ok);
    if (good.length === 0) {
      rows.push({ model, level, failed: true, attempts: runs.length });
      continue;
    }

    const totals = good.map((run) => run.msTotal);
    rows.push({
      model,
      level,
      failed: false,
      runs: good.length,
      medianMs: median(totals),
      worstMs: Math.max(...totals),
      firstTextMs: median(good.map((run) => run.msToFirstText ?? 0)),
      inputTokens: median(good.map((run) => run.inputTokens)),
      outputTokens: median(good.map((run) => run.outputTokens)),
      thoughtTokens: median(good.map((run) => run.thoughtTokens)),
      coversEveryone: good.every((run) => run.coversEveryone),
    });
  }
}

const s = (ms) => `${(ms / 1000).toFixed(1)}s`;

console.log(`\n### Measured against ${BASE_URL}\n`);
console.log(
  "| Model | Thinking | Runs | Median | Worst | First text | In / out / thought tokens | Covers all 6 |"
);
console.log("| --- | --- | --- | --- | --- | --- | --- | --- |");
for (const row of rows) {
  if (row.failed) {
    console.log(
      `| \`${row.model}\` | ${row.level} | 0 / ${row.attempts} | — | — | — | — | every run failed |`
    );
    continue;
  }
  console.log(
    `| \`${row.model}\` | ${row.level} | ${row.runs} | ${s(row.medianMs)} | ${s(row.worstMs)} | ${s(row.firstTextMs)} | ${row.inputTokens} / ${row.outputTokens} / ${row.thoughtTokens} | ${row.coversEveryone ? "yes" : "NO"} |`
  );
}

const worst = Math.max(...rows.filter((r) => !r.failed).map((r) => r.worstMs));
if (Number.isFinite(worst)) {
  console.log(
    `\nWorst run overall: ${s(worst)} against a ${TIMEOUT_SECONDS}s function limit ` +
      `and a ${TARGET_SECONDS}s product target.`
  );
  console.log(
    worst / 1000 < TIMEOUT_SECONDS
      ? "Verdict: streaming inside the request holds — no background job needed."
      : "Verdict: DOES NOT FIT. Spec §4.1e needs revisiting."
  );
}

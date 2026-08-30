import { GoogleGenAI } from "@google/genai";

import {
  describeCost,
  isPricedModel,
  priceCall,
  ZERO_USAGE,
  type Cost,
  type TokenUsage,
} from "./cost";

/**
 * A1 — the one place in this project that talks to Gemini.
 *
 * Everything in Track A that calls a model goes through here: the Group
 * Matching Agent ([A4](../../tasks/todo.md)), the Constraint Updater
 * ([A7](../../tasks/todo.md)) and the Context Resolver
 * ([A12](../../tasks/todo.md)). No other file constructs a client, names a
 * model, or sizes an output budget.
 *
 * It holds no prompts and no domain logic. What it does hold is the three
 * things [F2](../../docs/decisions/runtime-budget.md) had to learn the hard
 * way, so that nobody has to learn them twice:
 *
 * 1. **An output cap has to be sized for the thinking, not the answer.**
 * 2. **A truncated stream must fail as a truncation**, not as bad JSON.
 * 3. **A 429 must surface immediately**, because the SDK's silent retry looks
 *    exactly like a hang and turns a quota error into a fake latency number.
 */

/**
 * The two jobs a model does in this system, and the reason there are two
 * configurations rather than one ([spec §6.4](../../docs/spec.md)):
 *
 * - `matching` — the Group Matching Agent. All the reasoning in the system
 *   happens in this single call, and there is no second agent to catch its
 *   mistakes, so it gets the stronger model.
 * - `extraction` — the Constraint Updater and the Context Resolver. Twins: free
 *   text in, one small validated object out. A lite model is enough, and they
 *   run often enough that latency and quota matter more than depth.
 */
export type LlmTask = "matching" | "extraction";

/**
 * Gemini's effort dial: how hard the model thinks before it answers. Routine
 * matching runs at `low` ([spec §6.4](../../docs/spec.md)) — F2 measured the
 * same input at 4.7s on `low` and 207.8s on `high`, and the thinking is billed
 * at the output rate, so the dial moves latency and cost together.
 *
 * **These are the levels we know of, not the levels that are allowed.** Google's
 * own SDK type ends in `(string & {})`, which is Google saying any other string
 * is valid too. An unrecognised value is passed through, for the same reason an
 * unrecognised model is.
 *
 * The risk it carries is quieter than a bad model name, and worth knowing: a
 * wrong model returns 404 within a second, while a wrong level may simply be
 * ignored and served at the API's default — an answer at a speed and price you
 * did not ask for, with nothing saying so. Which is why every call logs the
 * level it requested, next to the duration and the cost it actually got.
 */
export const KNOWN_THINKING_LEVELS = [
  "minimal",
  "low",
  "medium",
  "high",
] as const;
export type ThinkingLevel =
  (typeof KNOWN_THINKING_LEVELS)[number] | (string & {});

/**
 * ⚠️ **Thinking tokens are spent from this budget, and they dwarf the answer.**
 * A cap of 16,000 — generous for the answer alone — silently cut a response off
 * mid-object during [F2](../../docs/decisions/runtime-budget.md), because one
 * run spent 24,299 thought tokens against 1,566 of output. 65,536 is the
 * models' documented ceiling; a call stops when the model is finished, not when
 * this number is reached.
 */
export const MAX_OUTPUT_TOKENS = 65_536;

type TaskDefaults = {
  model: string;
  thinkingLevel: ThinkingLevel;
  /**
   * Our own client-side deadline, in ms.
   *
   * For `matching`, 290s — just under Vercel's 300s function limit, so the
   * thing that stops a run is the platform limit the budget was measured
   * against rather than a number we invented. F2 recorded a real
   * `gemini-3.6-flash` / `high` run at 207.8s; a client timeout of 180s had
   * aborted it mid-flight and logged the cap as the worst case.
   *
   * For `extraction`, 60s. These calls return one small object. A minute
   * without an answer is a fault, not a slow day, and the caller has a
   * deterministic fallback to take ([A13](../../tasks/todo.md)).
   */
  timeoutMs: number;
  /** Streaming is the architecture under test for matching (spec §4.1e). */
  stream: boolean;
};

const TASK_DEFAULTS: Record<LlmTask, TaskDefaults> = {
  matching: {
    model: "gemini-3.6-flash",
    thinkingLevel: "low",
    timeoutMs: 290_000,
    stream: true,
  },
  extraction: {
    model: "gemini-3.5-flash-lite",
    thinkingLevel: "low",
    timeoutMs: 60_000,
    stream: false,
  },
};

/**
 * The environment variables that override the defaults, per task.
 *
 * Model choice is configuration rather than code because
 * [A10](../../tasks/todo.md) is an experiment — "can the lite model hold six
 * profiles without dropping one?" — and an experiment that needs a commit to
 * change one variable is an experiment nobody runs twice.
 */
const ENV_KEYS: Record<LlmTask, { model: string; thinking: string }> = {
  matching: {
    model: "GEMINI_MATCHING_MODEL",
    thinking: "GEMINI_MATCHING_THINKING",
  },
  extraction: {
    model: "GEMINI_EXTRACTION_MODEL",
    thinking: "GEMINI_EXTRACTION_THINKING",
  },
};

export type LlmConfig = {
  task: LlmTask;
  /** Any string. Google is the authority on which models exist, not us. */
  model: string;
  thinkingLevel: ThinkingLevel;
  timeoutMs: number;
  stream: boolean;
};

/**
 * Resolves a task's configuration from the environment.
 *
 * **It validates nothing about the model name, on purpose.** An earlier version
 * refused any model missing from the price table, which got both cases wrong:
 * a model released next week was blocked even though Google would serve it, and
 * a model Google had retired sailed through because it was still in our table.
 * The table answers "do we know the price", which is a different question with a
 * different owner.
 *
 * So any string goes to the API, and Google's own error is the answer on whether
 * it exists. An unpriced model costs one log line saying so — never a failed
 * run. The report is where that becomes an error, via `assertReportableCost`.
 *
 * Takes the environment as an argument so it is testable without touching
 * `process.env`.
 */
export function resolveConfig(
  task: LlmTask,
  env: Record<string, string | undefined> = process.env
): LlmConfig {
  const defaults = TASK_DEFAULTS[task];
  const keys = ENV_KEYS[task];

  return {
    task,
    model: env[keys.model]?.trim() || defaults.model,
    thinkingLevel: env[keys.thinking]?.trim() || defaults.thinkingLevel,
    timeoutMs: defaults.timeoutMs,
    stream: defaults.stream,
  };
}

/** Whether this is a level we have documented. Never gates a call — see above. */
export function isKnownThinkingLevel(value: string): boolean {
  return (KNOWN_THINKING_LEVELS as readonly string[]).includes(value);
}

/** A misconfiguration. Raised before any call is made, never mid-run. */
export class LlmConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmConfigError";
  }
}

/** A call that failed. `rateLimited` distinguishes a quota wall from a fault. */
export class LlmCallError extends Error {
  readonly model: string;
  readonly task: LlmTask;
  readonly rateLimited: boolean;

  constructor(
    message: string,
    context: { model: string; task: LlmTask; rateLimited?: boolean }
  ) {
    super(message);
    this.name = "LlmCallError";
    this.model = context.model;
    this.task = context.task;
    this.rateLimited = context.rateLimited ?? false;
  }
}

/**
 * The response was cut off. **Its own error type, deliberately.**
 *
 * A truncated JSON response and a malformed one are indistinguishable at the
 * parser — `JSON.parse` blames the fragment either way — and F2 lost an
 * afternoon to exactly that: the cause was an output cap too small to hold the
 * thinking, and the symptom looked like a model returning bad JSON. A caller
 * that catches this knows to raise the cap or lower the thinking level, not to
 * rewrite its schema.
 */
export class LlmTruncatedError extends LlmCallError {
  constructor(context: {
    model: string;
    task: LlmTask;
    status: string;
    chars: number;
  }) {
    super(
      `response did not complete (status ${context.status}, ${context.chars} chars) — truncated, not malformed. ` +
        `Thinking is spent from max_output_tokens (currently ${MAX_OUTPUT_TOKENS}); raise the cap or lower the thinking level.`,
      { model: context.model, task: context.task }
    );
    this.name = "LlmTruncatedError";
  }
}

/** What one completed call spent, and what it would cost at paid-tier prices. */
export type LlmCallRecord = {
  task: LlmTask;
  model: string;
  thinkingLevel: ThinkingLevel;
  /** Wall clock for the whole call, ms. */
  ms: number;
  /** Time to the first visible character. Only meaningful on a streamed call. */
  msToFirstText: number | null;
  usage: TokenUsage;
  /**
   * The dollar figure **and how much to trust it**. `cost.usd` is `null` when
   * the model is not in the price table — never `0`, which would average into a
   * total as a real measurement.
   */
  cost: Cost;
};

export type LlmResult = LlmCallRecord & {
  /** The model's answer. JSON text when `jsonSchema` was supplied. */
  text: string;
};

export type LlmRequest = {
  task: LlmTask;
  /** The standing instruction. Stable across calls — the part worth caching later. */
  system: string;
  /** This call's input. */
  input: string;
  /**
   * A JSON Schema the answer must satisfy. Supply it. Every A-track caller
   * wants a typed object, and "no free-text parsing" is an acceptance criterion
   * of [A4](../../tasks/todo.md), not a style preference.
   */
  jsonSchema?: unknown;
  /** Overrides the task default. Matching streams; extraction does not. */
  stream?: boolean;
  /** Called as text arrives, on a streamed call. The whole point of streaming. */
  onText?: (chunk: string, soFar: string) => void;
  /**
   * Receives the usage record alongside the log line, so
   * [A5](../../tasks/todo.md)'s eval runner can total a scenario without
   * scraping stdout. Nothing persists these yet — `MatchRun` has no token or
   * cost columns, and adding them belongs with A4, which is what creates a run.
   */
  onUsage?: (record: LlmCallRecord) => void;
};

/**
 * Makes one call and returns its text, its tokens and its cost.
 *
 * Streaming and non-streaming share this path on purpose: the truncation check,
 * the token accounting and the cost line are the parts most likely to drift
 * apart if written twice, and they are the parts A1 exists to get right.
 */
export async function generate(request: LlmRequest): Promise<LlmResult> {
  const config = resolveConfig(request.task);
  const stream = request.stream ?? config.stream;
  const started = performance.now();

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new LlmConfigError(
      "GEMINI_API_KEY is not set. Copy .env.example to .env.local and put a key in it — https://aistudio.google.com/apikey."
    );
  }

  const ai = new GoogleGenAI({ apiKey });

  const params = {
    model: config.model,
    system_instruction: request.system,
    input: request.input,
    generation_config: {
      thinking_level: config.thinkingLevel,
      max_output_tokens: MAX_OUTPUT_TOKENS,
    },
    ...(request.jsonSchema
      ? {
          response_format: {
            type: "text" as const,
            mime_type: "application/json",
            schema: request.jsonSchema,
          },
        }
      : {}),
  };

  // maxRetries: 0 because the SDK retries a 429 by default, for minutes, in
  // silence — which is indistinguishable from a hang and records a quota wall as
  // a latency measurement. The caller decides whether to wait; see retryDelayMs.
  const options = { maxRetries: 0, timeout: config.timeoutMs };

  let text = "";
  let msToFirstText: number | null = null;
  let status: string | null = null;
  const usage: TokenUsage = { ...ZERO_USAGE };

  try {
    if (stream) {
      const events = await ai.interactions.create(
        { ...params, stream: true },
        options
      );

      for await (const event of events) {
        if (event.event_type === "step.delta" && event.delta.type === "text") {
          msToFirstText ??= performance.now() - started;
          text += event.delta.text;
          request.onText?.(event.delta.text, text);
        } else if (event.event_type === "interaction.completed") {
          status = event.interaction.status ?? null;
          readUsage(event.interaction.usage, usage);
        } else if (event.event_type === "error") {
          throw new Error(event.error?.message ?? "stream reported an error");
        }
      }
    } else {
      const interaction = await ai.interactions.create(
        { ...params, stream: false },
        options
      );
      text = interaction.output_text ?? "";
      status = interaction.status ?? null;
      readUsage(interaction.usage, usage);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    throw new LlmCallError(withModelHint(message, config), {
      model: config.model,
      task: config.task,
      rateLimited: isRateLimited(message),
    });
  }

  // A stream that ends without a completion event, or an interaction in any
  // other state, produced a fragment. Say so here — downstream, JSON.parse
  // would blame the fragment and hide the cause.
  if (status !== "completed") {
    throw new LlmTruncatedError({
      model: config.model,
      task: config.task,
      status: status ?? "none",
      chars: text.length,
    });
  }

  const record: LlmCallRecord = {
    task: config.task,
    model: config.model,
    thinkingLevel: config.thinkingLevel,
    ms: Math.round(performance.now() - started),
    msToFirstText: msToFirstText === null ? null : Math.round(msToFirstText),
    usage,
    cost: priceCall(config.model, usage),
  };

  logCall(record);
  request.onUsage?.(record);

  return { ...record, text };
}

function readUsage(
  source:
    | {
        total_input_tokens?: number;
        total_output_tokens?: number;
        total_thought_tokens?: number;
        total_cached_tokens?: number;
      }
    | undefined,
  into: TokenUsage
): void {
  into.inputTokens = source?.total_input_tokens ?? 0;
  into.outputTokens = source?.total_output_tokens ?? 0;
  into.thoughtTokens = source?.total_thought_tokens ?? 0;
  into.cachedTokens = source?.total_cached_tokens ?? 0;
}

/**
 * One line per call, greppable. Prints the thinking level that was *requested*
 * alongside the duration and cost that came back — a level the API did not
 * recognise and quietly ignored shows up as the mismatch between them.
 */
export function formatCallRecord(record: LlmCallRecord): string {
  const { usage } = record;
  return [
    "[llm]",
    `task=${record.task}`,
    `model=${record.model}`,
    `thinking=${record.thinkingLevel}`,
    `ms=${record.ms}`,
    record.msToFirstText === null
      ? null
      : `ms_first_text=${record.msToFirstText}`,
    `in=${usage.inputTokens}`,
    `out=${usage.outputTokens}`,
    `thought=${usage.thoughtTokens}`,
    usage.cachedTokens > 0 ? `cached=${usage.cachedTokens}` : null,
    `cost=${describeCost(record.cost)}`,
    isKnownThinkingLevel(record.thinkingLevel)
      ? null
      : `thinking_level_unrecognised=true`,
  ]
    .filter(Boolean)
    .join(" ");
}

function logCall(record: LlmCallRecord): void {
  console.info(formatCallRecord(record));
}

/**
 * Whether a failure was the quota wall rather than a fault. On the free tier
 * this is a routine outcome, not an exception — `gemini-3.6-flash` allows 20
 * requests per **day** (spec §6.4).
 */
export function isRateLimited(message: string): boolean {
  return /quota|RESOURCE_EXHAUSTED|\b429\b/i.test(message);
}

/**
 * How long the API asked us to wait, in ms, if it said so. Its own number beats
 * any backoff we invent — it knows when the window rolls over.
 */
export function retryDelayMs(message: string): number | null {
  const match = message.match(/retry in ([\d.]+)s/i);
  return match ? Math.ceil(Number(match[1]) * 1000) : null;
}

/**
 * Google's "model not found" is correct but context-free — it does not know the
 * name came from an environment variable. Since a retired model is now the
 * ordinary way this fails (nothing in this project holds a list of live models,
 * deliberately), the error says where to look.
 */
function withModelHint(message: string, config: LlmConfig): string {
  const notFound = /not found|NOT_FOUND|\b404\b|no longer available/i.test(
    message
  );
  if (!notFound) return message;
  const key = ENV_KEYS[config.task].model;
  return (
    `${message} — model "${config.model}" for task "${config.task}". ` +
    `It may have been retired; check ${key} against https://ai.google.dev/gemini-api/docs/models.` +
    (isPricedModel(config.model)
      ? ` It is still listed in PRICING in lib/llm/cost.ts, which does not mean it exists — remove it once you confirm.`
      : "")
  );
}

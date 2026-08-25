import { GoogleGenAI } from "@google/genai";
import { buildWorstCasePayload } from "./payload";
import { MATCH_RESULT_JSON_SCHEMA, matchResultSchema } from "./schema";

/**
 * F2 — the runtime spike.
 *
 * One real Gemini call over the worst-case payload, streamed, timed. This is
 * throwaway code that answers one question: does a matching run fit inside a
 * Vercel function, so that spec §4.1e ("stream inside a request, no background
 * job") holds? A4 writes the real agent afterwards, against the budget this
 * produces.
 */

/**
 * Both verified working on this project's free-tier key on 2026-08-25, and
 * chosen to span the range: a lite model that does not think, and a flash model
 * that does. Measured once each, they land ~5s and ~30s apart.
 *
 * Three candidates were ruled out by the API itself, not by preference:
 * `gemini-2.5-pro` returns 404 "no longer available to new users";
 * `gemini-3.1-pro-preview` returns a quota of **0** on the free tier, as does
 * every pro-class model — the free tier is flash-class only; and
 * `gemini-3.7-flash` answers "currently experiencing high demand" after ~2
 * minutes rather than serving a free-tier request.
 */
export const SPIKE_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
] as const;

/** Gemini's equivalent of an effort dial. */
export const SPIKE_THINKING_LEVELS = ["low", "high"] as const;

export type SpikeRun = {
  model: string;
  thinkingLevel: string;
  ok: boolean;
  error: string | null;
  /** Time until the stream produced anything at all. */
  msToFirstEvent: number | null;
  /** Time until the first visible character — what the user actually waits for. */
  msToFirstText: number | null;
  /** Wall clock for the whole call. This is the number the timeout has to fit. */
  msTotal: number;
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  stopReason: string | null;
  /** The free tier's per-minute quota was hit. Not a latency result — retry it. */
  rateLimited: boolean;
  /** How many ranked options came back. Should be 3 (§4.1c). */
  optionCount: number | null;
  /** Whether every option justified every one of the six participants (§4.1c). */
  coversEveryone: boolean | null;
};

const SYSTEM_PROMPT = `You are the Group Matching Agent for a system that schedules get-togethers.

You receive every confirmed participant's profile, their home neighbourhood and travel tolerance, their busy calendar blocks, and a shortlist of candidate venues with per-participant straight-line distances and opening hours.

Return the top 3 options, ranked. Each option pairs one venue with one datetime.

Rules:
- Every option must respect every participant's hard constraints. A hard constraint is not a preference.
- The venue must be open at the proposed time, and every participant must be free then.
- Prefer the option whose worst-off participant is least badly off. Between two options that tie on the worst-off person, prefer the one that treats the second-worst better.
- Write a justification for EVERY participant on EVERY option, addressed to that person, in their own terms. Never omit anyone.
- A justification never tells a person what the option cost them relative to an alternative they did not get.
- Take the rejection history seriously: the reasons given are constraints now, not opinions.`;

function buildUserMessage(): string {
  const payload = buildWorstCasePayload();
  return [
    `Occasion: ${payload.occasion}`,
    `Cycle: ${payload.cycle} of 3`,
    "",
    "Rejection history:",
    JSON.stringify(payload.rejection_history, null, 2),
    "",
    "Participants:",
    JSON.stringify(payload.participants, null, 2),
    "",
    "Candidate venues (distances_km is straight-line, per participant id):",
    JSON.stringify(payload.candidates, null, 2),
    "",
    "Return the ranked top 3.",
  ].join("\n");
}

export type ProgressEvent =
  | { stage: "start"; model: string; thinkingLevel: string }
  | { stage: "writing"; chars: number }
  | { stage: "done" };

/**
 * Runs one measured call. Streams, because streaming inside the request is the
 * architecture being tested — a non-streaming call would measure the wrong thing.
 */
export async function runSpike(
  model: string,
  thinkingLevel: string,
  onProgress?: (event: ProgressEvent) => void
): Promise<SpikeRun> {
  const started = performance.now();
  let msToFirstEvent: number | null = null;
  let msToFirstText: number | null = null;

  const base: SpikeRun = {
    model,
    thinkingLevel,
    ok: false,
    error: null,
    msToFirstEvent: null,
    msToFirstText: null,
    msTotal: 0,
    inputTokens: 0,
    outputTokens: 0,
    thoughtTokens: 0,
    stopReason: null,
    rateLimited: false,
    optionCount: null,
    coversEveryone: null,
  };

  onProgress?.({ stage: "start", model, thinkingLevel });

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
    const ai = new GoogleGenAI({ apiKey });

    const stream = await ai.interactions.create(
      {
        model,
        stream: true,
        system_instruction: SYSTEM_PROMPT,
        input: buildUserMessage(),
        generation_config: {
          thinking_level: thinkingLevel,
          // Thinking tokens are spent from this same budget, and at `high` they
          // dwarf the answer — 16000 truncated the JSON mid-object. 65536 is the
          // models' documented ceiling; the run stops when it is done, not here.
          max_output_tokens: 65536,
        },
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: MATCH_RESULT_JSON_SCHEMA,
        },
      },
      // The SDK retries a 429 by default, for minutes, silently — which looks
      // exactly like a hang and quietly turns a quota error into a fake latency
      // number. Surface it instead and let the runner decide.
      { maxRetries: 0, timeout: 180_000 }
    );

    // The completed event carries the token usage; the text arrives as deltas.
    let text = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let thoughtTokens = 0;
    let status: string | null = null;

    for await (const event of stream) {
      msToFirstEvent ??= performance.now() - started;

      if (event.event_type === "step.delta" && event.delta.type === "text") {
        msToFirstText ??= performance.now() - started;
        text += event.delta.text;
        onProgress?.({ stage: "writing", chars: text.length });
      } else if (event.event_type === "interaction.completed") {
        status = event.interaction.status ?? null;
        inputTokens = event.interaction.usage?.total_input_tokens ?? 0;
        outputTokens = event.interaction.usage?.total_output_tokens ?? 0;
        thoughtTokens = event.interaction.usage?.total_thought_tokens ?? 0;
      } else if (event.event_type === "error") {
        throw new Error(event.error?.message ?? "stream reported an error");
      }
    }

    const msTotal = performance.now() - started;
    onProgress?.({ stage: "done" });

    // No completion event means the stream ended early — the text is a fragment,
    // and JSON.parse would blame the fragment rather than the truncation.
    if (status !== "completed") {
      return {
        ...base,
        error: `response did not complete (status ${status ?? "none"}, ${text.length} chars) — likely truncated`,
        msToFirstEvent,
        msToFirstText,
        msTotal: Math.round(msTotal),
      };
    }

    const parsed = matchResultSchema.safeParse(JSON.parse(text));
    const expected = buildWorstCasePayload().participants.length;

    return {
      ...base,
      ok: parsed.success,
      error: parsed.success ? null : "response failed schema validation",
      msToFirstEvent,
      msToFirstText,
      msTotal: Math.round(msTotal),
      inputTokens,
      outputTokens,
      thoughtTokens,
      stopReason: status,
      optionCount: parsed.success ? parsed.data.options.length : null,
      coversEveryone: parsed.success
        ? parsed.data.options.every((o) => o.justifications.length === expected)
        : null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return {
      ...base,
      error: message,
      rateLimited: /quota|RESOURCE_EXHAUSTED|\b429\b/i.test(message),
      msToFirstEvent,
      msToFirstText,
      msTotal: Math.round(performance.now() - started),
    };
  }
}

/**
 * How long the API asked us to wait, in ms, if it said so. Its own number beats
 * any backoff we invent — it knows when the per-minute window rolls over.
 */
export function retryDelayMs(message: string): number | null {
  const match = message.match(/retry in ([\d.]+)s/i);
  return match ? Math.ceil(Number(match[1]) * 1000) : null;
}

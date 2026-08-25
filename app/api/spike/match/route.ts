import { runSpike, type ProgressEvent, type SpikeRun } from "@/lib/spike/match";

/**
 * F2 spike route. One measured matching run per request, streamed as NDJSON:
 * progress lines while it works, one final line with the metrics.
 *
 * `maxDuration` is set to the Hobby plan's ceiling deliberately. The point of
 * the measurement is to find the real duration, so the route must not be the
 * thing that cuts it short.
 */
export const maxDuration = 300;

/**
 * Guard: the deploy URL is public. The free tier costs nothing, but it has a
 * rate limit that a stranger could burn through, and the key behind it is ours.
 */
function enabled(): boolean {
  return process.env.SPIKE_ENABLED === "1";
}

export async function POST(request: Request): Promise<Response> {
  if (!enabled()) {
    return Response.json(
      { error: "Spike route disabled. Set SPIKE_ENABLED=1 to run it." },
      { status: 403 }
    );
  }

  let model = "gemini-3.6-flash";
  let thinkingLevel = "high";
  try {
    const body = (await request.json()) as {
      model?: string;
      thinkingLevel?: string;
    };
    model = body.model ?? model;
    thinkingLevel = body.thinkingLevel ?? thinkingLevel;
  } catch {
    // No body — run the defaults.
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const write = (line: ProgressEvent | { result: SpikeRun }) => {
        controller.enqueue(encoder.encode(JSON.stringify(line) + "\n"));
      };
      const result = await runSpike(model, thinkingLevel, write);
      write({ result });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
    },
  });
}

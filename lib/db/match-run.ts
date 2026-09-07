/**
 * A4 — writing a matching run down (spec §4.1d).
 *
 * "Every matching run is persisted in full: the shortlist that went in, the
 * ranked options that came out, the per-participant justification, the chosen
 * option, and the cycle number — recorded from the first day. This is
 * impossible to reconstruct retroactively."
 *
 * ## Why this is two functions and not one
 *
 * `toMatchRunCreate` is a pure mapping from A4's draft to a Prisma create
 * input. `persistMatchRun` is the four lines that hand it to the database.
 *
 * The split is what makes the mapping testable, and right now that matters
 * more than usual: **there is no Postgres in dev and none in CI**, so every
 * decision lives in the pure half where tests can reach it without a
 * connection, and the impure half is four lines.
 * `__tests__/match-run-db.test.ts` covers the round trip and skips itself
 * until a `DATABASE_URL` exists.
 *
 * A `MatchRun` row requires a `Meeting` row — `meetingId` is a foreign key
 * with `onDelete: Cascade`, and `initiateMeeting` in [`./meetings.ts`](meetings.ts)
 * is what creates one. Nothing here creates a meeting, and nothing here
 * touches `Meeting.status`, `cycleCount` or `currentDatetime`: a matching run
 * is a thing that happens *to* a meeting, and B5 owns the meeting.
 *
 * The seam, and which task wires it up (B11), is in
 * [docs/decisions/matching-agent.md](../../docs/decisions/matching-agent.md).
 */

import type { LlmCallRecord } from "@/lib/llm/client";
import type { MatchRunDraft } from "@/lib/matching/agent";
import { getPrisma } from "./client";
import type { Prisma, PrismaClient } from "@/lib/generated/prisma/client";

/**
 * The exact row shape, as Prisma's `matchRun.create({ data })` wants it.
 *
 * Written out rather than aliased to `Prisma.MatchRunCreateInput`, so that
 * adding a column to the schema shows up here as a type error and gets a
 * decision, instead of being silently left unwritten.
 */
export type MatchRunCreateData = {
  meetingId: string;
  cycleNumber: number;
  shortlist: Prisma.InputJsonValue;
  model: string | null;
  thinkingLevel: string | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  thoughtTokens: number | null;
  cachedTokens: number | null;
  costUsd: number | null;
  costBasis: string | null;
  options: {
    create: {
      rank: number;
      venuePlaceId: string | null;
      venueName: string;
      venueAddress: string | null;
      venueLat: number | null;
      venueLng: number | null;
      proposedDatetime: Date;
      participantJustifications: Prisma.InputJsonValue;
      tradeoffs: Prisma.InputJsonValue;
      unverified: Prisma.InputJsonValue;
    }[];
  };
};

/**
 * Into a `jsonb` column.
 *
 * The cast is real and worth naming: `MatchOption.tradeoffs` is `unknown` in
 * the domain types **on purpose** — the model writes it, A4's JSON Schema
 * fixes its shape at the boundary, and nothing deterministic branches on it
 * (`lib/types/matching.ts`). So there is no type here to narrow, only a value
 * that has already been validated once and is now being stored.
 *
 * The round trip through `JSON.stringify` is not decoration either. A
 * `shortlist` carries `Date` objects inside its time slots, and Prisma's
 * `jsonb` input type does not accept a `Date` — serialising here turns them
 * into ISO strings once, in the open, rather than failing at the driver.
 * Whoever reads a run back parses those strings; see the note in A5's runner.
 */
function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

/**
 * A4's draft, as a row.
 *
 * `call` is optional because a run can exist without one: A5 may replay a
 * recorded answer, and a future offline mode has no tokens to report. Absent
 * means every cost column stays `NULL` — never `0`, which would average into
 * a report as a real measurement (`lib/llm/cost.ts`, `CostBasis`).
 */
export function toMatchRunCreate(
  draft: MatchRunDraft,
  call?: LlmCallRecord
): MatchRunCreateData {
  return {
    meetingId: draft.meetingId,
    cycleNumber: draft.cycleNumber,
    // The whole shortlist, burdens and all. §4.1d's "impossible to reconstruct
    // retroactively" is the reason it is stored rather than recomputed: the
    // venues, their opening hours and the group's calendars all move on.
    shortlist: asJson(draft.shortlist),

    model: call?.model ?? null,
    thinkingLevel: call ? String(call.thinkingLevel) : null,
    durationMs: call?.ms ?? null,
    inputTokens: call?.usage.inputTokens ?? null,
    outputTokens: call?.usage.outputTokens ?? null,
    thoughtTokens: call?.usage.thoughtTokens ?? null,
    cachedTokens: call?.usage.cachedTokens ?? null,
    // `usd` is already `null` for an unpriced model. Passing it through
    // unchanged is the point — see the comment above.
    costUsd: call?.cost.usd ?? null,
    costBasis: call?.cost.basis ?? null,

    options: {
      create: draft.options.map((option) => ({
        rank: option.rank,
        venuePlaceId: option.venue.placeId,
        venueName: option.venue.name,
        venueAddress: option.venue.address,
        venueLat: option.venue.location?.lat ?? null,
        venueLng: option.venue.location?.lng ?? null,
        proposedDatetime: option.proposedDatetime,
        participantJustifications: asJson(option.participantJustifications),
        tradeoffs: asJson(option.tradeoffs),
        unverified: asJson(option.unverified),
      })),
    },
  };
}

/**
 * Writes the run and its options.
 *
 * One nested create, which Prisma runs as a single transaction: a run with no
 * options, or options with no run, is not a state anything downstream knows
 * how to read. `MatchRun` is uniquely keyed on `(meetingId, cycleNumber)`, so
 * writing the same cycle twice raises rather than quietly producing two
 * histories of one weighing.
 *
 * Takes the client as an argument so a test can pass a transaction handle.
 */
export async function persistMatchRun(
  draft: MatchRunDraft,
  call?: LlmCallRecord,
  client: Pick<PrismaClient, "matchRun"> = getPrisma()
) {
  return client.matchRun.create({
    data: toMatchRunCreate(draft, call),
    include: { options: { orderBy: { rank: "asc" } } },
  });
}

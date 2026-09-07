import { afterAll, describe, expect, it } from "vitest";

import { getPrisma } from "@/lib/db/client";
import { persistMatchRun } from "@/lib/db/match-run";
import type { MatchRunDraft } from "@/lib/matching/agent";

/**
 * The one thing `lib/db/match-run.test.ts` cannot check: that Postgres accepts
 * the row, that the nested create really is one transaction, and that what
 * comes back out is what went in.
 *
 * **It skips itself when `DATABASE_URL` is unset**, which today is dev and CI
 * both. Writing it now anyway is the point: the alternative is a promise to
 * write it later, and A4's acceptance line says the run is persisted. Run it
 * against a real database with:
 *
 * ```
 * DATABASE_URL=postgresql://... npx vitest run __tests__/match-run-db.test.ts
 * ```
 *
 * It seeds its own user, group and meeting under a run-specific prefix and
 * deletes them afterwards, so it can run against a shared database without
 * leaving anything behind. It never touches a row it did not create.
 */

const CONNECTED = Boolean(process.env.DATABASE_URL);
const PREFIX = `a4-test-${Date.now()}`;

if (!CONNECTED) {
  console.info(
    "[match-run-db] skipped: DATABASE_URL is not set. This suite covers the round trip through Postgres; lib/db/match-run.test.ts covers the mapping."
  );
}

const SLOT_START = new Date("2026-09-10T17:00:00.000Z");
const SLOT_END = new Date("2026-09-10T20:00:00.000Z");

function draftFor(meetingId: string): MatchRunDraft {
  return {
    meetingId,
    cycleNumber: 1,
    shortlist: [],
    options: [
      {
        rank: 1,
        venue: {
          placeId: "place-near",
          name: "Near",
          address: "12 Rothschild",
          location: { lat: 32.0648, lng: 34.7749 },
        },
        proposedDatetime: SLOT_START,
        proposedEnd: SLOT_END,
        participantJustifications: { "u-dana": "A ten-minute walk for you." },
        tradeoffs: { tradedAway: "Yoav walks further." },
        unverified: [],
      },
      {
        rank: 2,
        venue: {
          placeId: "place-middle",
          name: "Middle",
          address: null,
          location: null,
        },
        proposedDatetime: SLOT_START,
        proposedEnd: SLOT_END,
        participantJustifications: { "u-dana": "Quieter, and still close." },
        tradeoffs: { tradedAway: "" },
        unverified: [{ kind: "opening_hours" as const }],
      },
    ],
  };
}

describe.skipIf(!CONNECTED)("a run, written down and read back", () => {
  const prisma = CONNECTED ? getPrisma() : null;

  afterAll(async () => {
    if (!prisma) return;
    // The group cascades to its meetings, which cascade to their runs and
    // options. The user is deleted separately because it is the group's
    // member rather than its parent.
    await Promise.all([
      prisma.group.deleteMany({ where: { name: { startsWith: PREFIX } } }),
      prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } }),
    ]);
  });

  it("writes the run and both its options in one go", async () => {
    if (!prisma) return;

    const [user, group] = await Promise.all([
      prisma.user.create({
        data: {
          email: `${PREFIX}@example.test`,
          name: "A4 test user",
          googleId: `${PREFIX}-google`,
        },
      }),
      prisma.group.create({ data: { name: `${PREFIX}-group` } }),
    ]);
    const meeting = await prisma.meeting.create({
      data: { groupId: group.id, initiatorId: user.id },
    });

    const written = await persistMatchRun(
      draftFor(meeting.id),
      undefined,
      prisma
    );

    expect(written.cycleNumber).toBe(1);
    expect(written.options).toHaveLength(2);
    expect(written.options[0].venueName).toBe("Near");
    expect(written.options[1].unverified).toEqual([{ kind: "opening_hours" }]);
    // A json column round-tripped, not stringified into one.
    expect(written.options[0].participantJustifications).toEqual({
      "u-dana": "A ten-minute walk for you.",
    });

    // §4.1d again: the same weighing cannot be recorded twice.
    await expect(
      persistMatchRun(draftFor(meeting.id), undefined, prisma)
    ).rejects.toThrow();
  });
});

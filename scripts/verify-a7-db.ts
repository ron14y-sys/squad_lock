/**
 * The six things about A7 that a unit test cannot reach
 * ([tasks/a7-plan.md](../tasks/a7-plan.md), "Verifying against a real
 * database").
 *
 *   npm run verify:a7-db
 *
 * Every test in this repo runs without a database, deliberately — which
 * leaves the database half of A7 checked by reading it. This script is the
 * other half, and it is a script rather than a test because it needs real
 * credentials and a real connection, and CI has neither.
 *
 * **It creates its own rows and deletes them in a `finally`.** The group and
 * the users cascade, so the meeting, the responses, the runs and the context
 * rows go with them. Nothing here touches a row it did not create.
 *
 * One check spends a real extraction call, because the point of it is that
 * the whole path runs — and one forces that call to fail, because the failure
 * path is the one nobody exercises by accident.
 */

import { Prisma } from "@/lib/generated/prisma/client";

import { getPrisma } from "@/lib/db/client";
import {
  findRejectedOption,
  recordRejectionOutcome,
  respondToMeeting,
} from "@/lib/db/meetings";
import { applyRejection } from "@/lib/extraction/apply-rejection";

const prisma = getPrisma();
const stamp = Date.now();
const tag = `a7-verify-${stamp}`;

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`
  );
  if (ok) passed += 1;
  else failed += 1;
}

async function main(): Promise<void> {
  const user = await prisma.user.create({
    data: {
      email: `${tag}@example.invalid`,
      name: "A7 Verify",
      googleId: `${tag}-google`,
    },
  });
  const group = await prisma.group.create({
    data: { name: tag, members: { create: { userId: user.id } } },
  });

  try {
    const meeting = await prisma.meeting.create({
      data: {
        groupId: group.id,
        initiatorId: user.id,
        responses: { create: { userId: user.id } },
      },
    });

    /* 1 — the correction and the outcome land together ------------------- */

    await recordRejectionOutcome(meeting.id, user.id, "soft", {
      noiseLevel: "quiet",
    });

    const afterFirst = await prisma.response.findUniqueOrThrow({
      where: { meetingId_userId: { meetingId: meeting.id, userId: user.id } },
    });
    const corrections = await prisma.participantMeetingContext.findMany({
      where: { meetingId: meeting.id, userId: user.id },
      orderBy: { createdAt: "asc" },
    });

    check(
      "the correction and the outcome land together",
      afterFirst.extractionOutcome === "soft" && corrections.length === 1,
      `outcome=${afterFirst.extractionOutcome}, rows=${corrections.length}`
    );
    check(
      "the correction reads back as it was written",
      JSON.stringify(corrections[0]?.softPreferences) ===
        JSON.stringify({ noiseLevel: "quiet" }),
      JSON.stringify(corrections[0]?.softPreferences)
    );

    /* 2 — a correction does not spend the one free amendment ------------- */

    const amended = await respondToMeeting(meeting.id, user.id, {
      kind: "amendment",
      note: "coming from work",
    });

    check(
      "a correction does not spend the free amendment",
      amended.meeting.cycleCount === 0,
      `cycleCount=${amended.meeting.cycleCount}`
    );

    // And the amendment after it does cost one, so the narrowed count did not
    // simply stop counting.
    const twice = await respondToMeeting(meeting.id, user.id, {
      kind: "amendment",
      note: "and my plans changed again",
    });
    check(
      "the second amendment still costs a cycle",
      twice.meeting.cycleCount === 1,
      `cycleCount=${twice.meeting.cycleCount}`
    );

    /* 3 — corrections append ---------------------------------------------- */

    await recordRejectionOutcome(meeting.id, user.id, "soft", {
      budget: "modest",
    });
    const appended = await prisma.participantMeetingContext.findMany({
      where: {
        meetingId: meeting.id,
        userId: user.id,
        NOT: { softPreferences: { equals: Prisma.DbNull } },
      },
    });
    check(
      "a second correction appends rather than overwriting",
      appended.length === 2,
      `${appended.length} correction rows`
    );

    /* 4 — findRejectedOption reads the latest run ------------------------- */

    for (const [cycle, venue] of [
      [1, "First Run Venue"],
      [2, "Latest Run Venue"],
    ] as const) {
      await prisma.matchRun.create({
        data: {
          meetingId: meeting.id,
          cycleNumber: cycle,
          shortlist: [],
          options: {
            create: {
              rank: 1,
              venueName: venue,
              proposedDatetime: new Date("2026-09-25T18:00:00.000Z"),
              proposedEnd: new Date("2026-09-25T21:00:00.000Z"),
              participantJustifications: {},
              tradeoffs: {},
            },
          },
        },
      });
    }

    const rejected = await findRejectedOption(meeting.id);
    check(
      "the rejected option comes from the latest run",
      rejected?.venueName === "Latest Run Venue",
      rejected?.venueName ?? "null"
    );

    /* 5 — the whole path, with a real call -------------------------------- */

    await applyRejection(meeting.id, user.id, "רועש לי מדי שם, משהו שקט יותר");
    const afterLive = await prisma.response.findUniqueOrThrow({
      where: { meetingId_userId: { meetingId: meeting.id, userId: user.id } },
    });
    check(
      "a live rejection records an outcome",
      afterLive.extractionOutcome !== null,
      String(afterLive.extractionOutcome)
    );

    /* 6 — and a failed call records why ----------------------------------- */

    const key = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    await applyRejection(meeting.id, user.id, "יקר לי מדי");
    if (key) process.env.GEMINI_API_KEY = key;

    const afterFailure = await prisma.response.findUniqueOrThrow({
      where: { meetingId_userId: { meetingId: meeting.id, userId: user.id } },
    });
    check(
      "a failed extraction records its cause instead of throwing",
      afterFailure.extractionOutcome === "failed_call",
      String(afterFailure.extractionOutcome)
    );
  } finally {
    // The group and the user cascade to everything this script made.
    await prisma.group.delete({ where: { id: group.id } });
    await prisma.user.delete({ where: { id: user.id } });
    console.log("\n  cleaned up\n");
  }

  console.log(`${passed} passed, ${failed} failed\n`);
  if (failed) process.exitCode = 1;
}

void main();

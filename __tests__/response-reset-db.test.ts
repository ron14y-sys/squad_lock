import { afterAll, describe, expect, it } from "vitest";

import { getPrisma } from "@/lib/db/client";
import {
  resetResponsesForNewProposal,
  respondToMeeting,
} from "@/lib/db/meetings";
import { MeetingStatus, ResponseStatus } from "@/lib/generated/prisma/client";

/**
 * #176: a new proposal asks everyone still in again. Before the fix an
 * approval of proposal 1 stood for proposal 2, and the meeting could close
 * on a place the person was never shown.
 *
 * Calls `resetResponsesForNewProposal` directly, as `weigh()` does inside
 * its transaction — no Gemini call. That `weigh()` really calls it is read
 * in the code, not proved here.
 *
 * **It skips itself when `DATABASE_URL` is unset**, same as
 * `meetings-confirmation-db.test.ts`:
 *
 * ```
 * DATABASE_URL=postgresql://... npx vitest run __tests__/response-reset-db.test.ts
 * ```
 *
 * It seeds its own rows under a run-specific prefix and deletes them
 * afterwards.
 */

const CONNECTED = Boolean(process.env.DATABASE_URL);
const PREFIX = `response-reset-test-${Date.now()}`;

if (!CONNECTED) {
  console.info(
    "[response-reset-db] skipped: DATABASE_URL is not set. This suite covers the round trip through Postgres."
  );
}

describe.skipIf(!CONNECTED)(
  "responses reset when a new proposal goes out (#176)",
  () => {
    const prisma = CONNECTED ? getPrisma() : null;

    afterAll(async () => {
      if (!prisma) return;
      // Sequential for the same FK reason as meetings-confirmation-db.test.ts.
      await prisma.group.deleteMany({
        where: { name: { startsWith: PREFIX } },
      });
      await prisma.user.deleteMany({
        where: { email: { startsWith: PREFIX } },
      });
    });

    it("asks everyone still in again, keeps who dropped out and what was said", async () => {
      if (!prisma) return;

      const [dana, yoav, noa] = await Promise.all(
        ["dana", "yoav", "noa"].map((name) =>
          prisma.user.create({
            data: {
              email: `${PREFIX}-${name}@example.test`,
              name,
              googleId: `${PREFIX}-${name}-google`,
            },
          })
        )
      );
      const group = await prisma.group.create({
        data: { name: `${PREFIX}-group` },
      });
      const meeting = await prisma.meeting.create({
        data: {
          groupId: group.id,
          initiatorId: dana.id,
          status: MeetingStatus.awaiting,
          currentDatetime: new Date("2026-09-10T17:00:00.000Z"),
          responses: {
            create: [
              { userId: dana.id },
              { userId: yoav.id },
              { userId: noa.id },
            ],
          },
        },
      });

      // Proposal 1: Dana approves, Noa drops out, Yoav objects.
      await respondToMeeting(meeting.id, dana.id, { kind: "approve" });
      await respondToMeeting(meeting.id, noa.id, { kind: "cant_make_it" });
      await respondToMeeting(meeting.id, yoav.id, {
        kind: "doesnt_suit",
        reasonText: "רחוק לי מדי",
      });
      // The objection's sentence lives on its own row (A8's applyRejection
      // writes it; seeded here so no extraction call is made).
      await prisma.participantMeetingContext.create({
        data: {
          meetingId: meeting.id,
          userId: yoav.id,
          rejectionText: "רחוק לי מדי",
        },
      });

      // Proposal 2 lands — what `weigh()` writes, without the model.
      await prisma.$transaction(async (tx) => {
        await resetResponsesForNewProposal(tx, meeting.id);
        await tx.meeting.update({
          where: { id: meeting.id },
          data: { status: MeetingStatus.awaiting },
        });
      });

      const statusOf = async (userId: string) =>
        (
          await prisma.response.findUniqueOrThrow({
            where: { meetingId_userId: { meetingId: meeting.id, userId } },
          })
        ).status;

      expect(await statusOf(dana.id)).toBe(ResponseStatus.pending);
      expect(await statusOf(yoav.id)).toBe(ResponseStatus.pending);
      expect(await statusOf(noa.id)).toBe(ResponseStatus.cant_make_it);

      // Yoav approves proposal 2. Dana has not seen it, so it must not close.
      const afterYoav = await respondToMeeting(meeting.id, yoav.id, {
        kind: "approve",
      });
      expect(afterYoav.meeting.status).toBe("awaiting");
      expect(afterYoav.justClosed).toBe(false);

      // Dana approves it too — now it closes.
      const afterDana = await respondToMeeting(meeting.id, dana.id, {
        kind: "approve",
      });
      expect(afterDana.meeting.status).toBe("closed");

      // The timeline's copy of the objection survived the reset.
      const rejections = await prisma.participantMeetingContext.findMany({
        where: { meetingId: meeting.id, userId: yoav.id },
      });
      expect(rejections.map((row) => row.rejectionText)).toEqual([
        "רחוק לי מדי",
      ]);
    });
  }
);

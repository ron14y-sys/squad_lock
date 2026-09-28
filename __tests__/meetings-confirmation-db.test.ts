import { afterAll, describe, expect, it } from "vitest";

import { getPrisma } from "@/lib/db/client";
import { respondToMeeting } from "@/lib/db/meetings";
import { MeetingStatus } from "@/lib/generated/prisma/client";

/**
 * The one thing `lib/db/meetings.test.ts` cannot check: that the transaction
 * inside `respondToMeeting` really does flip a real `Meeting` row to
 * `closed` once everyone still in has approved (spec §3 step 8) — and, just
 * as important, that it does *not* flip it early. Same split, same reason,
 * as `__tests__/match-run-db.test.ts` next to `lib/db/match-run.test.ts`.
 *
 * **It skips itself when `DATABASE_URL` is unset**, which today is dev and
 * CI both:
 *
 * ```
 * DATABASE_URL=postgresql://... npx vitest run __tests__/meetings-confirmation-db.test.ts
 * ```
 *
 * It seeds its own users, group and meeting under a run-specific prefix and
 * deletes them afterwards. It never touches a row it did not create.
 */

const CONNECTED = Boolean(process.env.DATABASE_URL);
const PREFIX = `meeting-confirm-test-${Date.now()}`;

if (!CONNECTED) {
  console.info(
    "[meetings-confirmation-db] skipped: DATABASE_URL is not set. This suite covers the round trip through Postgres."
  );
}

describe.skipIf(!CONNECTED)(
  "meeting confirmation against a real database",
  () => {
    const prisma = CONNECTED ? getPrisma() : null;

    afterAll(async () => {
      if (!prisma) return;
      // Sequential, not Promise.all: the group cascades to its meetings, but
      // Meeting.initiatorId has no cascade back to User, so deleting the
      // user concurrently with (or before) that cascade races
      // meetings_initiatorId_fkey. Same fix, same reason, as
      // __tests__/match-run-db.test.ts.
      await prisma.group.deleteMany({
        where: { name: { startsWith: PREFIX } },
      });
      await prisma.user.deleteMany({
        where: { email: { startsWith: PREFIX } },
      });
    });

    /** Two users, one group, one meeting already `awaiting` with both Response rows. */
    async function seedAwaitingMeeting(tag: string) {
      if (!prisma) throw new Error("no prisma");

      const [dana, yoav] = await Promise.all([
        prisma.user.create({
          data: {
            email: `${PREFIX}-${tag}-dana@example.test`,
            name: "Dana",
            googleId: `${PREFIX}-${tag}-dana-google`,
          },
        }),
        prisma.user.create({
          data: {
            email: `${PREFIX}-${tag}-yoav@example.test`,
            name: "Yoav",
            googleId: `${PREFIX}-${tag}-yoav-google`,
          },
        }),
      ]);
      const group = await prisma.group.create({
        data: { name: `${PREFIX}-${tag}-group` },
      });
      const meeting = await prisma.meeting.create({
        data: {
          groupId: group.id,
          initiatorId: dana.id,
          status: MeetingStatus.awaiting,
          currentDatetime: new Date("2026-09-10T17:00:00.000Z"),
          responses: {
            create: [{ userId: dana.id }, { userId: yoav.id }],
          },
        },
      });

      return { dana, yoav, meeting };
    }

    it("closes the meeting when the last still-in participant approves", async () => {
      if (!prisma) return;
      const { dana, yoav, meeting } = await seedAwaitingMeeting("approve");

      const afterDana = await respondToMeeting(meeting.id, dana.id, {
        kind: "approve",
      });
      expect(afterDana.meeting.status).toBe("awaiting");

      const afterYoav = await respondToMeeting(meeting.id, yoav.id, {
        kind: "approve",
      });
      expect(afterYoav.meeting.status).toBe("closed");
      // B8 part two reads this to decide whether to fire the "meeting
      // confirmed" email — proving it's set for real, not just in the pure
      // transitionFlags unit tests.
      expect(afterYoav.justClosed).toBe(true);
    });

    it("closes the meeting when the last non-approver drops out instead of approving", async () => {
      if (!prisma) return;
      const { dana, yoav, meeting } = await seedAwaitingMeeting("dropout");

      const afterDana = await respondToMeeting(meeting.id, dana.id, {
        kind: "approve",
      });
      expect(afterDana.justClosed).toBe(false);

      const afterYoav = await respondToMeeting(meeting.id, yoav.id, {
        kind: "cant_make_it",
      });

      expect(afterYoav.meeting.status).toBe("closed");
      expect(afterYoav.justClosed).toBe(true);
    });

    it("does not close the meeting while someone still in hasn't responded", async () => {
      if (!prisma) return;
      const { dana, meeting } = await seedAwaitingMeeting("partial");

      const afterDana = await respondToMeeting(meeting.id, dana.id, {
        kind: "approve",
      });

      expect(afterDana.meeting.status).toBe("awaiting");

      const row = await prisma.meeting.findUniqueOrThrow({
        where: { id: meeting.id },
      });
      expect(row.status).toBe(MeetingStatus.awaiting);
    });

    it("does not reopen or close a meeting once it is closed — a further response is refused", async () => {
      if (!prisma) return;
      const { dana, yoav, meeting } = await seedAwaitingMeeting("no-reopen");

      await respondToMeeting(meeting.id, dana.id, { kind: "approve" });
      await respondToMeeting(meeting.id, yoav.id, { kind: "approve" });

      await expect(
        respondToMeeting(meeting.id, dana.id, { kind: "approve" })
      ).rejects.toThrow();
    });
  }
);

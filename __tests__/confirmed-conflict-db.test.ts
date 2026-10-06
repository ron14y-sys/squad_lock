import { afterAll, describe, expect, it } from "vitest";

import { getPrisma } from "@/lib/db/client";
import { findConflictingMeetings } from "@/lib/db/conflict-dismissal";
import { respondToMeeting } from "@/lib/db/meetings";
import { MeetingStatus } from "@/lib/generated/prisma/client";

/**
 * A confirmed meeting is a clash for a new proposal (B5b). Before the fix
 * `findConflictingMeetings` read open meetings only, so an evening already
 * agreed in one group never warned against a proposal at the same hour in
 * another — and approving it double-booked the person silently.
 *
 * **It skips itself when `DATABASE_URL` is unset**, same as
 * `meetings-confirmation-db.test.ts`:
 *
 * ```
 * DATABASE_URL=postgresql://... npx vitest run __tests__/confirmed-conflict-db.test.ts
 * ```
 *
 * It seeds its own rows under a run-specific prefix and deletes them
 * afterwards.
 */

const CONNECTED = Boolean(process.env.DATABASE_URL);
const PREFIX = `confirmed-conflict-test-${Date.now()}`;

if (!CONNECTED) {
  console.info(
    "[confirmed-conflict-db] skipped: DATABASE_URL is not set. This suite covers the round trip through Postgres."
  );
}

describe.skipIf(!CONNECTED)("a confirmed meeting is a conflict", () => {
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

  /** One user in `statuses.length` groups, one meeting each, an hour apart. */
  async function seed(tag: string, statuses: MeetingStatus[]) {
    if (!prisma) throw new Error("no prisma");
    const user = await prisma.user.create({
      data: {
        email: `${PREFIX}-${tag}@example.test`,
        name: tag,
        googleId: `${PREFIX}-${tag}-google`,
      },
    });
    const meetings = [];
    for (const [i, status] of statuses.entries()) {
      const group = await prisma.group.create({
        data: { name: `${PREFIX}-${tag}-group-${i}` },
      });
      meetings.push(
        await prisma.meeting.create({
          data: {
            groupId: group.id,
            initiatorId: user.id,
            status,
            // 19:00 and 20:00 in Israel — same evening, an hour apart.
            currentDatetime: new Date(Date.UTC(2026, 9, 15, 16 + i, 0, 0)),
            responses: { create: [{ userId: user.id }] },
          },
        })
      );
    }
    return { user, meetings };
  }

  it("pairs a confirmed meeting with an open one at the same hour", async () => {
    if (!prisma) return;
    const {
      user,
      meetings: [confirmed, open],
    } = await seed("mixed", [MeetingStatus.closed, MeetingStatus.awaiting]);

    const pairs = await findConflictingMeetings(user.id);

    expect(pairs).toHaveLength(1);
    expect([pairs[0].meetingA.id, pairs[0].meetingB.id].sort()).toEqual(
      [confirmed.id, open.id].sort()
    );
  });

  it("does not pair two confirmed meetings — nothing is left to decide", async () => {
    if (!prisma) return;
    const { user } = await seed("both-closed", [
      MeetingStatus.closed,
      MeetingStatus.closed,
    ]);

    expect(await findConflictingMeetings(user.id)).toEqual([]);
  });

  it("approving the open one leaves the confirmed one confirmed", async () => {
    if (!prisma) return;
    const {
      user,
      meetings: [confirmed, open],
    } = await seed("approve", [MeetingStatus.closed, MeetingStatus.awaiting]);

    const result = await respondToMeeting(open.id, user.id, {
      kind: "approve",
    });

    expect(result.cancelledConflicts).toEqual([]);
    const after = await prisma.meeting.findUniqueOrThrow({
      where: { id: confirmed.id },
    });
    expect(after.status).toBe(MeetingStatus.closed);
  });
});

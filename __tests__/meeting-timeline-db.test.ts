import { afterAll, describe, expect, it } from "vitest";

import { getPrisma } from "@/lib/db/client";
import { respondToMeeting } from "@/lib/db/meetings";
import { getMeetingDetail } from "@/lib/db/meeting-detail";
import { MeetingStatus } from "@/lib/generated/prisma/client";

/**
 * #262: every timeline event that names a person says who, by id, so the
 * screen can mark the viewer's own. Two members share a name here, which is
 * the case a name alone gets wrong.
 *
 * **It skips itself when `DATABASE_URL` is unset**, same as the other `-db`
 * suites, and seeds its own rows under a run-specific prefix.
 */

const CONNECTED = Boolean(process.env.DATABASE_URL);
const PREFIX = `meeting-timeline-test-${Date.now()}`;

if (!CONNECTED) {
  console.info(
    "[meeting-timeline-db] skipped: DATABASE_URL is not set. This suite covers the timeline built from Postgres."
  );
}

describe.skipIf(!CONNECTED)("the timeline says who did what (#262)", () => {
  const prisma = CONNECTED ? getPrisma() : null;

  afterAll(async () => {
    if (!prisma) return;
    await prisma.group.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  });

  it("carries the id of the person each event names", async () => {
    const [dana, otherDana, yoav] = await Promise.all(
      ["dana", "dana2", "yoav"].map((key) =>
        prisma!.user.create({
          data: {
            email: `${PREFIX}-${key}@example.test`,
            name: key === "yoav" ? "yoav" : "dana",
            googleId: `${PREFIX}-${key}-google`,
          },
        })
      )
    );
    const group = await prisma!.group.create({
      data: { name: `${PREFIX}-group` },
    });
    const meeting = await prisma!.meeting.create({
      data: {
        groupId: group.id,
        initiatorId: dana.id,
        status: MeetingStatus.awaiting,
        currentDatetime: new Date("2026-09-10T17:00:00.000Z"),
        responses: {
          create: [
            { userId: dana.id },
            { userId: otherDana.id },
            { userId: yoav.id },
          ],
        },
      },
    });

    await respondToMeeting(meeting.id, otherDana.id, { kind: "approve" });
    // A rejection and an amendment, as their own rows (no extraction call).
    await prisma!.participantMeetingContext.create({
      data: {
        meetingId: meeting.id,
        userId: yoav.id,
        rejectionText: "רחוק לי מדי",
      },
    });
    await prisma!.participantMeetingContext.create({
      data: { meetingId: meeting.id, userId: dana.id, note: "מאחר/ת קצת" },
    });

    const detail = await getMeetingDetail(meeting.id, dana.id);
    const who = detail!.timeline.map((event) =>
      event.kind === "proposed" ? null : [event.kind, event.byId]
    );

    expect(who).toEqual(
      expect.arrayContaining([
        ["initiated", dana.id],
        ["response", otherDana.id],
        ["response", yoav.id],
        ["amendment", dana.id],
      ])
    );
    expect(who).toHaveLength(4);
  });
});

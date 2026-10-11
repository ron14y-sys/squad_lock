import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { getPrisma } from "@/lib/db/client";
import type { BusyLookup } from "@/lib/matching/run-cycle";

/**
 * #251: "one of these needs to change" moves the meeting at once to another
 * time — or day — at the venue it already has. It used to send the meeting
 * back to `weighing`, where nothing ever ran it.
 *
 * Google's details, the email and the full weighing are stubbed: nothing
 * here may reach a paid API. **It skips itself when `DATABASE_URL` is
 * unset**, same as the other `-db` suites, and seeds its own rows under a
 * run-specific prefix.
 */

const CONNECTED = Boolean(process.env.DATABASE_URL);
const PREFIX = `conflict-reschedule-test-${Date.now()}`;

const notifyProposalWaiting = vi.hoisted(() => vi.fn());
const runCycle = vi.hoisted(() => vi.fn());
vi.mock("@/lib/email/notify", async (original) => ({
  ...(await original<object>()),
  notifyProposalWaiting,
}));
vi.mock("@/lib/db/places-cache", async (original) => ({
  ...(await original<object>()),
  // Open every day, 17:00 to midnight.
  fetchPlaceDetailsCached: async () => ({
    openingHours: [{ weekdays: [], from: "17:00", to: "00:00" }],
  }),
}));
vi.mock("@/lib/matching/run-cycle", async (original) => ({
  ...(await original<object>()),
  runCycle,
}));

const { sendMeetingBackToWeighing } = await import("@/lib/db/conflict-actions");
const { getMeetingDetail } = await import("@/lib/db/meeting-detail");

if (!CONNECTED) {
  console.info(
    "[conflict-reschedule-db] skipped: DATABASE_URL is not set. This suite covers the reschedule in Postgres."
  );
}

// Thursday 15 Oct 2026, 19:00 local (16:00Z): the time both meetings have.
const CLASH = new Date("2026-10-15T16:00:00.000Z");
const CLASH_END = new Date("2026-10-15T19:00:00.000Z");

describe.skipIf(!CONNECTED)("changing a meeting that clashes", () => {
  const prisma = CONNECTED ? getPrisma() : null;
  let dana = "";
  let meetingId = "";

  afterAll(async () => {
    if (!prisma) return;
    await prisma.group.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  });

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // Monday 12 Oct, 09:00 local: the clash is three days ahead.
    vi.setSystemTime(new Date("2026-10-12T06:00:00.000Z"));
    notifyProposalWaiting.mockReset();
    runCycle.mockReset();

    const n = Math.random().toString(36).slice(2, 8);
    const users = await Promise.all(
      ["dana", "noa", "yoav"].map((who) =>
        prisma!.user.create({
          data: {
            email: `${PREFIX}-${n}-${who}@example.test`,
            name: who,
            googleId: `${PREFIX}-${n}-${who}`,
            preferenceProfile: {
              create: { homeLat: 32.08, homeLng: 34.78, toleranceKm: 5 },
            },
          },
        })
      )
    );
    dana = users[0].id;

    const group = await prisma!.group.create({
      data: {
        name: `${PREFIX}-${n}`,
        members: { create: users.map((u) => ({ userId: u.id })) },
      },
    });
    // An evening meeting, proposed for Thursday at 19:00 and approved by two.
    const meeting = await prisma!.meeting.create({
      data: {
        groupId: group.id,
        initiatorId: dana,
        pinnedTime: "evening",
        status: "awaiting",
        currentDatetime: CLASH,
        cycleCount: 0,
        responses: {
          create: users.map((u, i) => ({
            userId: u.id,
            status: i < 2 ? "approved" : "pending",
          })),
        },
      },
    });
    meetingId = meeting.id;
    await prisma!.matchRun.create({
      data: {
        meetingId,
        cycleNumber: 1,
        shortlist: [],
        model: "gemini",
        options: {
          create: {
            rank: 1,
            venuePlaceId: `${PREFIX}-venue`,
            venueName: "Bar Shesh",
            venueLat: 32.081,
            venueLng: 34.781,
            proposedDatetime: CLASH,
            proposedEnd: CLASH_END,
            participantJustifications: { [dana]: "קרוב אלייך" },
            tradeoffs: {},
          },
        },
      },
    });

    // Dana's other meeting, in another group, at the same hour: confirmed.
    const other = await prisma!.group.create({
      data: {
        name: `${PREFIX}-${n}-other`,
        members: { create: [{ userId: dana }] },
      },
    });
    await prisma!.meeting.create({
      data: {
        groupId: other.id,
        initiatorId: dana,
        status: "closed",
        currentDatetime: CLASH,
        responses: { create: [{ userId: dana, status: "approved" }] },
      },
    });
  });

  it("moves it to another evening at the same venue, at once, and asks everyone again", async () => {
    await sendMeetingBackToWeighing(dana, meetingId);

    const meeting = await prisma!.meeting.findUniqueOrThrow({
      where: { id: meetingId },
      include: {
        responses: true,
        matchRuns: {
          orderBy: { cycleNumber: "asc" },
          include: { options: true },
        },
      },
    });
    expect(meeting.status).toBe("awaiting");
    expect(meeting.matchRuns).toHaveLength(2);
    const [moved] = meeting.matchRuns[1].options;
    expect(moved.venueName).toBe("Bar Shesh");
    expect(moved.participantJustifications).toEqual({ [dana]: "קרוב אלייך" });
    // Thursday evening is inside the clash's reach, so another day: the
    // nearest evening the venue is open, Wednesday or Friday at 18:00.
    expect(moved.proposedDatetime.toISOString()).toMatch(
      /^2026-10-1[46]T15:00:00\.000Z$/
    );
    expect(meeting.currentDatetime).toEqual(moved.proposedDatetime);
    // Every approval was of the old time; no rematch was spent; no model ran.
    expect(meeting.responses.every((r) => r.status === "pending")).toBe(true);
    expect(meeting.cycleCount).toBe(0);
    expect(meeting.matchRuns[1].model).toBeNull();
    expect(runCycle).not.toHaveBeenCalled();
    expect(notifyProposalWaiting).toHaveBeenCalledWith(meetingId);
  });

  it("says on the timeline that the time changed because of a clash", async () => {
    await sendMeetingBackToWeighing(dana, meetingId);

    const detail = await getMeetingDetail(meetingId, dana);
    const proposals = detail!.timeline.filter((e) => e.kind === "proposed");
    expect(proposals.at(-1)).toMatchObject({
      cycleNumber: 2,
      venueName: "Bar Shesh",
      reweighedBecause: "השעה שונתה בגלל התנגשות",
    });
    expect(detail!.remainingCycles).toBe(3);
  });

  it("weighs it in full, straight away, when the venue has no other evening for the group", async () => {
    // Everyone busy all week except Thursday evening — which clashes.
    const busyFor: BusyLookup = async (userIds) => ({
      busy: new Map(
        userIds.map((id) => [
          id,
          [
            { start: new Date("2026-10-12T00:00:00Z"), end: CLASH },
            { start: CLASH_END, end: new Date("2026-10-25T00:00:00Z") },
          ],
        ])
      ),
      unread: [],
      rejected: [],
    });
    const { rescheduleForConflict } = await import("@/lib/matching/reschedule");

    expect(await rescheduleForConflict(meetingId, new Date(), busyFor)).toBe(
      "reweighed"
    );
    expect(runCycle).toHaveBeenCalledWith(meetingId, expect.any(Date), busyFor);
    const meeting = await prisma!.meeting.findUniqueOrThrow({
      where: { id: meetingId },
    });
    expect(meeting.status).toBe("weighing");
    expect(meeting.currentDatetime).toBeNull();
  });
});

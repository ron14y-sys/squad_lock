import { afterAll, describe, expect, it, vi } from "vitest";

import { getPrisma } from "@/lib/db/client";
import { straightLineKm } from "@/lib/matching/distance";
import { CLOSER_FACTOR } from "@/lib/extraction/tonight-bounds";
import type { ConstraintUpdate } from "@/lib/extraction/constraint-updater";

/**
 * #220, end to end below the model: a rejection's reading, turned into this
 * meeting's numbers and stored. The model's answer is fixed by hand — what
 * is under test is everything after it: measuring "closer" against the
 * rejected venue from where this person starts, turning "earlier" into a
 * latest start, and writing it all on one row.
 *
 * **It skips itself when `DATABASE_URL` is unset**, same as the other `-db`
 * suites. Seeds its own rows under a run-specific prefix and deletes them.
 */

const CONNECTED = Boolean(process.env.DATABASE_URL);
const PREFIX = `rejection-bounds-test-${Date.now()}`;

const answer = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/extraction/constraint-updater", async (original) => ({
  ...(await original<object>()),
  runConstraintUpdater: async () => ({ update: answer.current, call: {} }),
}));

const { applyRejection } = await import("@/lib/extraction/apply-rejection");

if (!CONNECTED) {
  console.info(
    "[rejection-bounds-db] skipped: DATABASE_URL is not set. This suite covers the round trip through Postgres."
  );
}

const HOME = { lat: 32.0853, lng: 34.7818 };
const VENUE = { lat: 32.11, lng: 34.8 };

describe.skipIf(!CONNECTED)("a rejection's distance and time, stored", () => {
  const prisma = CONNECTED ? getPrisma() : null;

  afterAll(async () => {
    if (!prisma) return;
    await prisma.group.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  });

  async function seed() {
    if (!prisma) throw new Error("no prisma");
    const dana = await prisma.user.create({
      data: {
        email: `${PREFIX}-dana@example.test`,
        name: "Dana",
        googleId: `${PREFIX}-dana`,
        preferenceProfile: {
          create: { homeLat: HOME.lat, homeLng: HOME.lng, toleranceKm: 8 },
        },
      },
    });
    const group = await prisma.group.create({
      data: { name: `${PREFIX}-group` },
    });
    const meeting = await prisma.meeting.create({
      data: {
        groupId: group.id,
        initiatorId: dana.id,
        responses: { create: [{ userId: dana.id }] },
      },
    });
    await prisma.matchRun.create({
      data: {
        meetingId: meeting.id,
        cycleNumber: 1,
        shortlist: [],
        options: {
          create: {
            rank: 1,
            venueName: "Far Bar",
            venueLat: VENUE.lat,
            venueLng: VENUE.lng,
            // 21:00 local.
            proposedDatetime: new Date("2026-09-12T18:00:00.000Z"),
            proposedEnd: new Date("2026-09-12T21:00:00.000Z"),
            participantJustifications: {},
            tradeoffs: [],
          },
        },
      },
    });
    return { dana, meeting };
  }

  it("measures 'closer' from home, turns 'earlier' into a latest start, and keeps the rest", async () => {
    const { dana, meeting } = await seed();
    answer.current = {
      softPreferences: { venueKinds: ["bar"] },
      distance: { kind: "closer" },
      start: { direction: "earlier" },
      notThisPlace: false,
      untranslated: "רוצה חניה",
      objection: "soft",
    } satisfies ConstraintUpdate;

    await applyRejection(meeting.id, dana.id, "רחוק ומאוחר, ובא לי בר עם חניה");

    const row = await prisma!.participantMeetingContext.findFirstOrThrow({
      where: { meetingId: meeting.id, userId: dana.id },
    });
    const distanceKm = straightLineKm(HOME, VENUE);
    expect(row.toleranceKm).toBeCloseTo(
      Math.round(Math.min(distanceKm, 8) * CLOSER_FACTOR * 10) / 10
    );
    expect(row.toleranceKm!).toBeLessThan(distanceKm);
    expect(row.latestStart).toBe("20:30");
    expect(row.earliestStart).toBeNull();
    expect(row.softPreferences).toEqual({ venueKinds: ["bar"] });
    expect(row.untranslated).toBe("רוצה חניה");
    expect(row.rejectionOutcome).toBe("soft");
  });
});

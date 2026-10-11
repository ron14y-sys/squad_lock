import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { getPrisma } from "@/lib/db/client";
import { initiateMeeting } from "@/lib/db/meetings";
import {
  checkNamedVenue,
  MAX_FAILED_VENUE_LOOKUPS,
} from "@/lib/meetings/venue-check";
import type { Candidate } from "@/lib/types";

/**
 * #240: a typed venue is checked before the meeting exists, and every miss is
 * counted on the member's row — so the cap on Places lookups survives a
 * reload, and only opening a meeting gives the lookups back.
 *
 * **It skips itself when `DATABASE_URL` is unset**, same as the other `-db`
 * suites. Seeds its own rows under a run-specific prefix and deletes them.
 */

const CONNECTED = Boolean(process.env.DATABASE_URL);

// The route's collaborators: who is signed in, no run after the response,
// and what Google answers for a typed name.
const session = vi.hoisted(() => ({ current: null as unknown }));
const textSearch = vi.hoisted(() => ({ fn: (() => null) as unknown }));
vi.mock("@/auth", () => ({ auth: async () => session.current }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("@/lib/places/client", async (original) => ({
  ...(await original<object>()),
  findPlaceByText: (...args: unknown[]) =>
    (textSearch.fn as (...a: unknown[]) => unknown)(...args),
}));

const { POST } = await import("@/app/api/groups/[id]/meetings/route");
const PREFIX = `venue-check-test-${Date.now()}`;

if (!CONNECTED) {
  console.info(
    "[venue-check-db] skipped: DATABASE_URL is not set. This suite covers the counter in Postgres."
  );
}

const place = (primaryType: string | null): Candidate => ({
  placeId: `${PREFIX}-${primaryType}`,
  name: "Somewhere",
  address: null,
  location: { lat: 32.08, lng: 34.78 },
  neighbourhood: null,
  types: primaryType ? [primaryType] : [],
  primaryType,
});

describe.skipIf(!CONNECTED)("a typed venue, checked and counted", () => {
  const prisma = CONNECTED ? getPrisma() : null;
  const lookup = vi.fn();
  let groupId = "";
  let initiatorId = "";

  afterAll(async () => {
    if (!prisma) return;
    await prisma.group.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  });

  beforeEach(async () => {
    lookup.mockReset();
    const n = Math.random().toString(36).slice(2, 8);
    const users = await Promise.all(
      ["a", "b", "c"].map((who, i) =>
        prisma!.user.create({
          data: {
            email: `${PREFIX}-${n}-${who}@example.test`,
            name: who,
            googleId: `${PREFIX}-${n}-${who}`,
            preferenceProfile: {
              create: { homeLat: 32.08 + i * 0.01, homeLng: 34.78 },
            },
          },
        })
      )
    );
    const group = await prisma!.group.create({
      data: {
        name: `${PREFIX}-${n}`,
        members: { create: users.map((u) => ({ userId: u.id })) },
      },
    });
    groupId = group.id;
    initiatorId = users[0].id;
  });

  const failures = async () =>
    (
      await prisma!.groupMember.findUniqueOrThrow({
        where: { groupId_userId: { groupId, userId: initiatorId } },
      })
    ).failedVenueLookups;

  it("passes a café, searched for around the group's homes, and counts nothing", async () => {
    lookup.mockResolvedValue(place("cafe"));

    expect(await checkNamedVenue(groupId, initiatorId, "Café", lookup)).toEqual(
      { ok: true }
    );
    // The middle of the three homes (32.08, 32.09, 32.10).
    expect(lookup).toHaveBeenCalledWith("Café", {
      lat: expect.closeTo(32.09, 6),
      lng: expect.closeTo(34.78, 6),
    });
    expect(await failures()).toBe(0);
  });

  it("says what went wrong, counts each miss, and locks on the third", async () => {
    lookup
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(place("yoga_studio"))
      .mockResolvedValueOnce(place("gym"));

    expect(await checkNamedVenue(groupId, initiatorId, "Typo", lookup)).toEqual(
      { ok: false, error: "venue_not_found", attemptsLeft: 2 }
    );
    expect(await checkNamedVenue(groupId, initiatorId, "Yoga", lookup)).toEqual(
      { ok: false, error: "venue_not_a_venue", attemptsLeft: 1 }
    );
    expect(await checkNamedVenue(groupId, initiatorId, "Gym", lookup)).toEqual({
      ok: false,
      error: "venue_not_a_venue",
      attemptsLeft: 0,
    });
    expect(await failures()).toBe(MAX_FAILED_VENUE_LOOKUPS);
  });

  it("makes no more lookups once locked, even for a real café", async () => {
    await prisma!.groupMember.update({
      where: { groupId_userId: { groupId, userId: initiatorId } },
      data: { failedVenueLookups: MAX_FAILED_VENUE_LOOKUPS },
    });
    lookup.mockResolvedValue(place("cafe"));

    expect(await checkNamedVenue(groupId, initiatorId, "Café", lookup)).toEqual(
      { ok: false, error: "venue_lookup_blocked", attemptsLeft: 0 }
    );
    expect(lookup).not.toHaveBeenCalled();
  });

  it("gives the lookups back when the member opens a meeting", async () => {
    await prisma!.groupMember.update({
      where: { groupId_userId: { groupId, userId: initiatorId } },
      data: { failedVenueLookups: MAX_FAILED_VENUE_LOOKUPS },
    });

    await initiateMeeting(groupId, initiatorId, {});

    expect(await failures()).toBe(0);
  });

  it("lets the meeting through, uncounted, when Google cannot be asked", async () => {
    lookup.mockRejectedValue(new Error("places: quota"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await checkNamedVenue(groupId, initiatorId, "Café", lookup)).toEqual(
      { ok: true }
    );
    expect(await failures()).toBe(0);
  });

  it("does not look anything up when nobody in the group has a home", async () => {
    await prisma!.preferenceProfile.updateMany({
      where: { user: { groupMemberships: { some: { groupId } } } },
      data: { homeLat: null, homeLng: null },
    });

    expect(await checkNamedVenue(groupId, initiatorId, "Café", lookup)).toEqual(
      { ok: true }
    );
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe.skipIf(!CONNECTED)(
  "opening a meeting with a typed venue (#240)",
  () => {
    const prisma = CONNECTED ? getPrisma() : null;
    let groupId = "";
    let userId = "";

    beforeEach(async () => {
      const n = Math.random().toString(36).slice(2, 8);
      const users = await Promise.all(
        ["a", "b", "c"].map((who) =>
          prisma!.user.create({
            data: {
              email: `${PREFIX}-route-${n}-${who}@example.test`,
              name: who,
              googleId: `${PREFIX}-route-${n}-${who}`,
              preferenceProfile: { create: { homeLat: 32.08, homeLng: 34.78 } },
            },
          })
        )
      );
      const group = await prisma!.group.create({
        data: {
          name: `${PREFIX}-route-${n}`,
          members: { create: users.map((u) => ({ userId: u.id })) },
        },
      });
      groupId = group.id;
      userId = users[0].id;
      session.current = { user: { id: userId } };
    });

    const open = (venue: string) =>
      POST(
        new Request("http://test/meetings", {
          method: "POST",
          body: JSON.stringify({ venue }),
        }),
        { params: Promise.resolve({ id: groupId }) }
      );

    it("sends a yoga studio back to the form, and opens no meeting", async () => {
      textSearch.fn = async () => place("yoga_studio");

      const response = await open("סטודיו יוגה");

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({
        error: "venue_not_a_venue",
        venue: "סטודיו יוגה",
        attemptsLeft: 2,
      });
      expect(await prisma!.meeting.count({ where: { groupId } })).toBe(0);
    });

    it("answers 409 once the lookups are used up", async () => {
      await prisma!.groupMember.update({
        where: { groupId_userId: { groupId, userId } },
        data: { failedVenueLookups: MAX_FAILED_VENUE_LOOKUPS },
      });

      const response = await open("בר");

      expect(response.status).toBe(409);
      expect((await response.json()).error).toBe("venue_lookup_blocked");
    });

    it("opens the meeting for a real bar", async () => {
      textSearch.fn = async () => place("bar");

      const response = await open("בר הים");

      expect(response.status).toBe(201);
      expect(await prisma!.meeting.count({ where: { groupId } })).toBe(1);
    });
  }
);

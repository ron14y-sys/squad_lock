// #240: the venue an initiator types, checked before the meeting exists, so a
// studio or a typo is caught in the form instead of on the group's proposal.
// Each miss costs a Places call, so misses are counted on the member's row,
// not in the form: a reload cannot buy more lookups.

import { getPrisma } from "@/lib/db/client";
import { findPlaceByText } from "@/lib/places/client";
import { isVenuePrimaryType } from "@/lib/preferences/vocabulary";
import { meanOf } from "@/lib/matching/run-cycle";
import type { Candidate, LatLng } from "@/lib/types";

/** Misses allowed before the venue field is locked, until a meeting is opened. */
export const MAX_FAILED_VENUE_LOOKUPS = 3;

export type VenueCheck =
  | { ok: true }
  | {
      ok: false;
      error: "venue_not_found" | "venue_not_a_venue" | "venue_lookup_blocked";
      /** Misses left before the field locks; 0 means it is locked now. */
      attemptsLeft: number;
    };

/**
 * Is `name` a restaurant, bar, café, bakery or ice-cream shop Google can
 * find near the group?
 *
 * Passes, without counting anything, whenever it cannot ask: nobody in the
 * group has set a home to search around, or Google failed. The run looks the
 * name up again anyway (`assembleRun`) and says on the proposal what it
 * found, so a check that cannot be made must not stop a meeting.
 */
export async function checkNamedVenue(
  groupId: string,
  userId: string,
  name: string,
  lookup: (
    query: string,
    near: LatLng
  ) => Promise<Candidate | null> = findPlaceByText
): Promise<VenueCheck> {
  const prisma = getPrisma();
  const where = { groupId_userId: { groupId, userId } };

  const member = await prisma.groupMember.findUniqueOrThrow({ where });
  if (member.failedVenueLookups >= MAX_FAILED_VENUE_LOOKUPS) {
    return { ok: false, error: "venue_lookup_blocked", attemptsLeft: 0 };
  }

  const profiles = await prisma.preferenceProfile.findMany({
    where: {
      user: { groupMemberships: { some: { groupId } } },
      homeLat: { not: null },
      homeLng: { not: null },
    },
    select: { homeLat: true, homeLng: true },
  });
  if (profiles.length === 0) return { ok: true };

  let found: Candidate | null;
  try {
    found = await lookup(
      name,
      meanOf(profiles.map((p) => ({ lat: p.homeLat!, lng: p.homeLng! })))
    );
  } catch (error) {
    console.warn("[venue-check] lookup failed, letting the run decide", error);
    return { ok: true };
  }
  if (found && isVenuePrimaryType(found.primaryType)) return { ok: true };

  const { failedVenueLookups } = await prisma.groupMember.update({
    where,
    data: { failedVenueLookups: { increment: 1 } },
  });
  return {
    ok: false,
    error: found ? "venue_not_a_venue" : "venue_not_found",
    attemptsLeft: Math.max(0, MAX_FAILED_VENUE_LOOKUPS - failedVenueLookups),
  };
}

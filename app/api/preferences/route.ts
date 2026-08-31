// Preference profile persistence (B3, spec §5.1) — GET loads the signed-in
// user's hard constraints, soft preferences, home location, travel
// tolerance and recurring mobility rules; PUT saves them.
//
// One row per user (prisma/schema.prisma's PreferenceProfile, userId
// unique), so "the current user" comes from the session rather than a URL
// param — nobody can read or write another participant's profile through
// this route.

import { auth } from "@/auth";
import { getPrisma } from "@/lib/db/client";
import { preferenceProfileInputSchema } from "@/lib/preferences/schema";
import { preferenceProfileFromRow } from "@/lib/types";

/** Mirrors the Prisma column defaults, for a user with no row yet. */
const EMPTY_PROFILE = {
  hardConstraints: {},
  softPreferences: {},
  home: null,
  homeNeighbourhood: null,
  toleranceKm: 5,
  recurringMobilityRules: [],
};

export async function GET(): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  const prisma = getPrisma();
  const row = await prisma.preferenceProfile.findUnique({ where: { userId } });

  // No row yet (onboarding not completed) is not an error — hand back the
  // same shape the client would get right after creating one, so it doesn't
  // need a separate "no profile" branch before the this-or-that game runs.
  return Response.json(row ? preferenceProfileFromRow(row) : EMPTY_PROFILE);
}

export async function PUT(request: Request): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const parsed = preferenceProfileInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid preference profile.", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  // The domain type keeps home location as one LatLng (see
  // lib/types/preference-profile-from-row.ts); Prisma keeps it as two
  // columns. This is the one place that has to know both.
  const { home, ...rest } = parsed.data;
  const homeColumns =
    home !== undefined ? { homeLat: home.lat, homeLng: home.lng } : {};

  const data = { ...rest, ...homeColumns };

  const prisma = getPrisma();
  const row = await prisma.preferenceProfile.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data },
  });

  return Response.json(preferenceProfileFromRow(row));
}

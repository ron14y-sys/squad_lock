import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { getPrisma } from "@/lib/db/client";
import { MissingHomeBanner } from "@/app/_components/MissingHomeBanner";
import { GroupsList } from "./GroupsList";

/**
 * #173: nothing used to send a first-time user through onboarding (spec §3
 * step 1) before they reached the groups list — a missing `PreferenceProfile`
 * row (never played the game) or a missing home point (played it, skipped
 * the map, #132) both left the matcher weighing them with an empty profile.
 * This is the one place every path into `/groups` passes through, whether
 * from the landing redirect (`app/page.tsx`) or a direct link.
 */
export default async function GroupsPage() {
  const session = await auth();
  if (session?.user) {
    const profile = await getPrisma().preferenceProfile.findUnique({
      where: { userId: session.user.id },
      select: { homeLat: true, homeLng: true },
    });
    if (!profile) redirect("/onboarding/preferences");
    if (profile.homeLat === null || profile.homeLng === null) {
      redirect("/profile/location");
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <MissingHomeBanner />
      <GroupsList />
    </div>
  );
}

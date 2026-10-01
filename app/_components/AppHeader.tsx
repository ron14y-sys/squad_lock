import Link from "next/link";

import { auth } from "@/auth";
import { countUnreadNotifications } from "@/lib/db/notifications";
import { Logo3D } from "./Logo3D";
import { ThemeToggle } from "./ThemeToggle";

// No task ever asked for this — B2 built sign-in itself, C1-C7 built the
// screens behind it, and nothing connected the two: there was no way into
// the app at all from the deployed site. Found live, fixed here rather than
// waiting for C10/C11 to catch it.
//
// #171: the logo doubles as the "home" link (standard web convention, so it
// needs no label of its own), and "קבוצות" is the one distinct destination
// worth a direct link — there is no separate cross-group meetings screen yet
// for a second one to point at.
export async function AppHeader() {
  const session = await auth();
  // #46 (C9): read here, directly, rather than from the client — this
  // component is already an async server component (same reasoning as the
  // comment above), so there is no round trip to save by making the badge
  // a client fetch of its own.
  const unreadCount = session?.user
    ? await countUnreadNotifications(session.user.id)
    : 0;

  return (
    <header className="safe-top sticky top-0 z-10 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-xl items-center justify-between gap-2 px-4">
        <Logo3D href={session?.user ? "/groups" : undefined} />
        <ThemeToggle />
        {session?.user ? (
          <div className="flex items-center gap-3">
            <Link href="/groups" className="sl-navlink">
              קבוצות
            </Link>
            <Link href="/notifications" className="sl-navlink relative">
              התראות
              {unreadCount > 0 && (
                <span
                  className="absolute -end-3 -top-2 rounded-full px-1.5 text-xs font-bold"
                  style={{
                    background: "var(--sl-acc)",
                    color: "var(--sl-onacc)",
                  }}
                >
                  {unreadCount}
                </span>
              )}
            </Link>
            <Link href="/profile" className="sl-navlink">
              פרופיל
            </Link>
            <span className="sl-sub hidden whitespace-nowrap sm:inline">
              {session.user.name}
            </span>
            <Link href="/api/auth/signout" className="sl-navlink">
              התנתק
            </Link>
          </div>
        ) : (
          <Link
            href="/"
            className="rounded-full px-3 py-1.5 text-sm font-bold whitespace-nowrap"
            style={{ background: "var(--sl-acc)", color: "var(--sl-onacc)" }}
          >
            התחבר
          </Link>
        )}
      </div>
    </header>
  );
}

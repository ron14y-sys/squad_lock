import Link from "next/link";

import { auth } from "@/auth";
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

  return (
    <header className="safe-top sticky top-0 z-10 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-xl items-center justify-between gap-2 px-4">
        {session?.user ? (
          <Link href="/groups" className="sl-logo">
            SquadLock
          </Link>
        ) : (
          <span className="sl-logo">SquadLock</span>
        )}
        <ThemeToggle />
        {session?.user ? (
          <div className="flex items-center gap-3">
            <Link
              href="/groups"
              className="text-sm font-bold whitespace-nowrap"
            >
              קבוצות
            </Link>
            <Link
              href="/profile"
              className="text-sm font-bold whitespace-nowrap"
            >
              פרופיל
            </Link>
            <span className="sl-sub hidden whitespace-nowrap sm:inline">
              {session.user.name}
            </span>
            <Link
              href="/api/auth/signout"
              className="text-sm font-bold whitespace-nowrap"
            >
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

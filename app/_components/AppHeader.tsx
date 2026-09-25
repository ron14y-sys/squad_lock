import Link from "next/link";

import { auth } from "@/auth";
import { ThemeToggle } from "./ThemeToggle";

// No task ever asked for this — B2 built sign-in itself, C1-C7 built the
// screens behind it, and nothing connected the two: there was no way into
// the app at all from the deployed site. Found live, fixed here rather than
// waiting for C10/C11 to catch it.
export async function AppHeader() {
  const session = await auth();

  return (
    <header className="safe-top sticky top-0 z-10 backdrop-blur">
      <div className="flex h-14 items-center justify-between gap-2 px-4">
        <span className="sl-logo">SquadLock</span>
        <ThemeToggle />
        {session?.user ? (
          <div className="flex items-center gap-3">
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
            href="/api/auth/signin"
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

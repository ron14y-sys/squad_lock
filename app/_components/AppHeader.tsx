import Link from "next/link";

import { auth } from "@/auth";

// No task ever asked for this — B2 built sign-in itself, C1-C7 built the
// screens behind it, and nothing connected the two: there was no way into
// the app at all from the deployed site. Found live, fixed here rather than
// waiting for C10/C11 to catch it.
export async function AppHeader() {
  const session = await auth();

  return (
    <header className="safe-top sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50/90 backdrop-blur dark:border-zinc-800 dark:bg-black/90">
      <div className="flex h-14 items-center justify-between px-4">
        <span className="text-lg font-semibold tracking-tight text-black dark:text-zinc-50">
          SquadLock
        </span>
        {session?.user ? (
          <div className="flex items-center gap-3">
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              {session.user.name}
            </span>
            <Link
              href="/api/auth/signout"
              className="text-sm font-medium text-zinc-900 dark:text-zinc-50"
            >
              התנתק
            </Link>
          </div>
        ) : (
          <Link
            href="/api/auth/signin"
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-50 dark:text-black"
          >
            התחבר
          </Link>
        )}
      </div>
    </header>
  );
}

"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type Kind = "loading" | "empty" | "error" | "notice";

/**
 * The three states every screen needs besides its content (C10): still
 * loading, nothing to show yet, and something went wrong. One component so
 * they look the same everywhere and can be restyled in one place.
 *
 * - `loading`: the message plus grey placeholder cards, so the page has a
 *   shape while it waits instead of one line of small text.
 * - `empty`: a plain card. Says what is missing, in the screen's own words.
 * - `error`: an alert with "try again". It reloads the page, which is the
 *   simplest retry that is always correct — each screen re-fetches on load.
 * - `notice`: a message with nothing to retry (not found, or not signed in).
 *   With `signIn`, it also offers the sign-in button and brings the person
 *   back to this page afterwards.
 */
export function ScreenState({
  kind,
  signIn = false,
  children,
}: {
  kind: Kind;
  signIn?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();

  if (kind === "loading") {
    return (
      <div role="status" aria-busy="true" className="sl-page">
        <p className="sl-sub">{children}</p>
        <div className="sl-skel" aria-hidden="true" />
        <div className="sl-skel" aria-hidden="true" />
        <div className="sl-skel short" aria-hidden="true" />
      </div>
    );
  }

  if (kind === "error") {
    return (
      <div role="alert" className="sl-page">
        <div className="sl-warn flex flex-col gap-3">
          <p>{children}</p>
          <button
            type="button"
            className="sl-btn self-start"
            onClick={() => window.location.reload()}
          >
            נסה שוב
          </button>
        </div>
      </div>
    );
  }

  const signInHref = pathname
    ? `/api/auth/signin?callbackUrl=${encodeURIComponent(pathname)}`
    : "/api/auth/signin";

  return (
    <div className="sl-page">
      <div className="sl-panel">
        <p>{children}</p>
        {kind === "notice" && signIn && (
          <Link href={signInHref} className="sl-btn go self-start">
            התחבר
          </Link>
        )}
      </div>
    </div>
  );
}

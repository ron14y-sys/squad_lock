"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * #132, piece 3. A profile with no home point cannot be weighed — the
 * matching agent refuses to skip a person it has no origin for — so the
 * first anyone learns of it would be their group's meeting failing to
 * produce a proposal. Say it here, before that, with the way to fix it.
 *
 * Stays silent on anything but a clear "signed in, and home is empty": a
 * signed-out visitor, a network error or a slow response must never put a
 * warning on a screen that is otherwise fine.
 */
export function MissingHomeBanner() {
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/preferences")
      .then((res) => (res.ok ? res.json() : null))
      .then((profile) => {
        if (!cancelled && profile && !profile.home) setMissing(true);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  if (!missing) return null;

  return (
    <div role="alert" className="sl-page !pb-0">
      <div className="sl-warn">
        עוד לא הגדרת שכונת מגורים, ובלי זה אי אפשר למצוא מקום שמתאים לכולם.{" "}
        <Link href="/profile/location" className="font-bold underline">
          הגדר עכשיו
        </Link>
      </div>
    </div>
  );
}

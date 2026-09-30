import Link from "next/link";

/**
 * #173: the profile pages had no link between them — only reachable by
 * typing the URL. One small nav, shared by all three, so each links to the
 * other two. `current` is skipped rather than shown disabled, since there is
 * nowhere useful for it to go.
 */
export function ProfileNav({
  current,
}: {
  current: "constraints" | "location" | "preferences";
}) {
  const links = [
    { key: "constraints", href: "/profile", label: "אילוצים קבועים" },
    { key: "location", href: "/profile/location", label: "שכונת מגורים" },
    {
      key: "preferences",
      href: "/onboarding/preferences",
      label: "משחק ההעדפות",
    },
  ] as const;

  return (
    <nav className="sl-sub flex flex-wrap gap-3 text-sm">
      {links
        .filter((link) => link.key !== current)
        .map((link) => (
          <Link key={link.key} href={link.href} className="font-bold underline">
            {link.label}
          </Link>
        ))}
    </nav>
  );
}

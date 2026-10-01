"use client";

import type { PointerEvent } from "react";
import { useRef } from "react";
import Link from "next/link";

/**
 * The header logo as a real, interactive 3D card — perspective + a
 * pointer-tracked tilt (the classic "tilt card" effect), a specular
 * highlight that follows the cursor, and layered shadows for actual depth,
 * not a flat rotated box. CSS custom properties, not React state: a
 * `pointermove` firing dozens of times a second has no business going
 * through a render.
 */
export function Logo3D({ href }: { href?: string }) {
  const cardRef = useRef<HTMLSpanElement>(null);

  function handleMove(event: PointerEvent<HTMLSpanElement>) {
    const card = cardRef.current;
    if (!card) return;

    const rect = card.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;

    card.style.setProperty("--tilt-x", `${(0.5 - py) * 28}deg`);
    card.style.setProperty("--tilt-y", `${(px - 0.5) * 28}deg`);
    card.style.setProperty("--glow-x", `${px * 100}%`);
    card.style.setProperty("--glow-y", `${py * 100}%`);
  }

  function handleLeave() {
    const card = cardRef.current;
    if (!card) return;
    card.style.setProperty("--tilt-x", "0deg");
    card.style.setProperty("--tilt-y", "0deg");
  }

  const card = (
    <span
      ref={cardRef}
      className="sl-logo-3d"
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
    >
      <span className="sl-logo-3d-shine" aria-hidden="true" />
      <span className="sl-logo-3d-text">SquadLock</span>
    </span>
  );

  return href ? (
    <Link href={href} className="sl-logo-3d-link">
      {card}
    </Link>
  ) : (
    <span className="sl-logo-3d-link">{card}</span>
  );
}

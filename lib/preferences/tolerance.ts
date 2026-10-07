// The travel-tolerance scale (spec §5.1): how far someone is willing to go,
// as a handful of named steps rather than a raw kilometre figure nobody
// remembers by week 6. Shared by the profile's standing answer
// (`LocationForm.tsx`) and #222's per-meeting one ("tonight" in
// `ResponseControls.tsx`) — the same scale means "ברגל tonight" and "ברגל"
// on the profile mean the same thing.

import type { Kilometres } from "@/lib/types";

/**
 * Labels the user sees; kilometres are what get stored and unit-tested.
 * Illustrative steps, not a measured product decision.
 */
export const TOLERANCE_OPTIONS: { label: string; km: Kilometres }[] = [
  { label: "ברגל", km: 1.5 },
  { label: "בשכונה", km: 3 },
  { label: "חצי מהעיר", km: 8 },
  { label: "בכל מקום", km: 20 },
];

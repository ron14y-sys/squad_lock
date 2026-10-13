-- #246, #247: why a meeting is stuck. Nullable with no default: meetings that
-- are already stuck keep "not recorded", and the panel words that neutrally.
CREATE TYPE "StuckReason" AS ENUM ('cycle_cap', 'no_time', 'no_venue');

ALTER TABLE "meetings" ADD COLUMN "stuckReason" "StuckReason";

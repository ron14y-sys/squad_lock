-- #248: keep the venue's Google Places types on the proposal, so the
-- rejection form can offer "this place" as a cuisine shortcut. Existing
-- options get an empty list and simply show no shortcut.
ALTER TABLE "match_options" ADD COLUMN "venueTypes" TEXT[] DEFAULT ARRAY[]::TEXT[];

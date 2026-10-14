-- #213: "בכל מקום" now means 30 km, not 20. A profile that picked it keeps
-- meaning "anywhere" (lib/preferences/tolerance.ts).
UPDATE "preference_profiles" SET "toleranceKm" = 30 WHERE "toleranceKm" = 20;

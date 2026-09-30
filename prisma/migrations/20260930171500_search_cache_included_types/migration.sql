-- #168: the chosen part of the day now sets `includedTypes` in the Nearby
-- Search itself (cafés only in the morning, etc.), so it has to be part of
-- this cache's key — otherwise a morning search would be served whatever an
-- earlier evening search for the same coordinates and radius already cached.
-- The table is only a cache (same reasoning as the #165 migration next to
-- this one); clearing it first means the new NOT NULL column never needs a
-- default for a row that has none.
DELETE FROM "place_search_cache";

-- DropIndex
DROP INDEX "place_search_cache_latKey_lngKey_radiusMeters_key";

-- AlterTable
ALTER TABLE "place_search_cache" ADD COLUMN     "includedTypes" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "place_search_cache_latKey_lngKey_radiusMeters_includedTypes_key" ON "place_search_cache"("latKey", "lngKey", "radiusMeters", "includedTypes");

-- AlterTable
ALTER TABLE "match_options" ALTER COLUMN "proposedEnd" DROP DEFAULT;

-- CreateTable
CREATE TABLE "place_search_cache" (
    "id" TEXT NOT NULL,
    "latKey" DOUBLE PRECISION NOT NULL,
    "lngKey" DOUBLE PRECISION NOT NULL,
    "radiusMeters" INTEGER NOT NULL,
    "results" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "place_search_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "place_details_cache" (
    "placeId" TEXT NOT NULL,
    "rating" DOUBLE PRECISION,
    "openingHours" JSONB NOT NULL DEFAULT '[]',
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "place_details_cache_pkey" PRIMARY KEY ("placeId")
);

-- CreateIndex
CREATE UNIQUE INDEX "place_search_cache_latKey_lngKey_radiusMeters_key" ON "place_search_cache"("latKey", "lngKey", "radiusMeters");

-- AlterTable
ALTER TABLE "match_options" ADD COLUMN     "venueSummary" TEXT,
ADD COLUMN     "venueType" TEXT;

-- AlterTable
ALTER TABLE "place_details_cache" ADD COLUMN     "summary" TEXT;

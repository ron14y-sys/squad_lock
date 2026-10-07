-- AlterTable
ALTER TABLE "participant_meeting_contexts" ADD COLUMN     "earliestStart" TEXT,
ADD COLUMN     "latestStart" TEXT,
ADD COLUMN     "toleranceKm" DOUBLE PRECISION,
ADD COLUMN     "untranslated" TEXT;

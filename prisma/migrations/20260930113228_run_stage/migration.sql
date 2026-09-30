-- CreateEnum
CREATE TYPE "RunStage" AS ENUM ('calendars', 'places', 'venue_details', 'model', 'saving');

-- AlterTable
ALTER TABLE "meetings" ADD COLUMN     "runStage" "RunStage";

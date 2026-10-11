-- #240: failed venue-name lookups per member, capped at 3 until they open a meeting.
ALTER TABLE "group_members" ADD COLUMN "failedVenueLookups" INTEGER NOT NULL DEFAULT 0;

-- #250: leaving a group, and a group admin.
--
-- `group_members."isAdmin"`: the one member who can delete the group and who
-- hands the role on when leaving. Existing groups get the member who joined
-- first — the one who created them — so none is left without an admin.
--
-- The notification kinds and columns are for the in-app notices about a
-- group: somebody left, the group became inactive, the admin deleted it, a
-- new admin. `notifications."groupId"` is not a foreign key on purpose: the
-- notice that a group was deleted must survive the group.

-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'member_left';
ALTER TYPE "NotificationKind" ADD VALUE 'group_inactive';
ALTER TYPE "NotificationKind" ADD VALUE 'group_deleted';
ALTER TYPE "NotificationKind" ADD VALUE 'became_admin';

-- AlterTable
ALTER TABLE "group_members" ADD COLUMN     "isAdmin" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "actorName" TEXT,
ADD COLUMN     "groupId" TEXT,
ADD COLUMN     "groupName" TEXT,
ADD COLUMN     "meetingsCancelled" INTEGER;

-- Backfill: the earliest member of each group is its admin.
UPDATE "group_members"
SET "isAdmin" = true
WHERE "id" IN (
  SELECT DISTINCT ON ("groupId") "id"
  FROM "group_members"
  ORDER BY "groupId", "joinedAt" ASC, "id" ASC
);

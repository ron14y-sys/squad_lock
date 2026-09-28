-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('invitation', 'proposal_waiting', 'meeting_confirmed', 'conflict_reweigh', 'stuck');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('sent', 'failed');

-- CreateTable
CREATE TABLE "notification_log" (
    "id" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL,
    "providerMessageId" TEXT,
    "errorMessage" TEXT,
    "meetingId" TEXT,
    "invitationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_log_meetingId_idx" ON "notification_log"("meetingId");

-- CreateIndex
CREATE INDEX "notification_log_invitationId_idx" ON "notification_log"("invitationId");

-- AddForeignKey
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "invitations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

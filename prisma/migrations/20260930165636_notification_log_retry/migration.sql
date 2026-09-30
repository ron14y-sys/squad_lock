-- AlterTable
ALTER TABLE "notification_log" ADD COLUMN     "attempt" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "retriedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "notification_log_status_retriedAt_idx" ON "notification_log"("status", "retriedAt");

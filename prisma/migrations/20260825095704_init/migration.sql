-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('weighing', 'awaiting', 'closed', 'stuck', 'cancelled');

-- CreateEnum
CREATE TYPE "ResponseStatus" AS ENUM ('pending', 'approved', 'cant_make_it', 'doesnt_suit');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "googleId" TEXT NOT NULL,
    "googleRefreshToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preference_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hardConstraints" JSONB NOT NULL DEFAULT '{}',
    "softPreferences" JSONB NOT NULL DEFAULT '{}',
    "homeLat" DOUBLE PRECISION,
    "homeLng" DOUBLE PRECISION,
    "homeNeighbourhood" TEXT,
    "toleranceKm" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "recurringMobilityRules" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "preference_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_members" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meetings" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "initiatorId" TEXT NOT NULL,
    "status" "MeetingStatus" NOT NULL DEFAULT 'weighing',
    "cycleCount" INTEGER NOT NULL DEFAULT 0,
    "pinnedDate" DATE,
    "pinnedTime" TEXT,
    "pinnedVenue" TEXT,
    "occasion" TEXT,
    "currentDatetime" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_runs" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "cycleNumber" INTEGER NOT NULL,
    "shortlist" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_options" (
    "id" TEXT NOT NULL,
    "matchRunId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "venuePlaceId" TEXT,
    "venueName" TEXT NOT NULL,
    "venueAddress" TEXT,
    "venueLat" DOUBLE PRECISION,
    "venueLng" DOUBLE PRECISION,
    "proposedDatetime" TIMESTAMP(3) NOT NULL,
    "participantJustifications" JSONB NOT NULL,
    "tradeoffs" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "responses" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ResponseStatus" NOT NULL DEFAULT 'pending',
    "reasonText" TEXT,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participant_meeting_contexts" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "originLat" DOUBLE PRECISION,
    "originLng" DOUBLE PRECISION,
    "originLabel" TEXT,
    "mobilityWindows" JSONB NOT NULL DEFAULT '[]',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "participant_meeting_contexts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_run_seen_contexts" (
    "matchRunId" TEXT NOT NULL,
    "contextId" TEXT NOT NULL,

    CONSTRAINT "match_run_seen_contexts_pkey" PRIMARY KEY ("matchRunId","contextId")
);

-- CreateTable
CREATE TABLE "conflict_dismissals" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "meetingAId" TEXT NOT NULL,
    "meetingBId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conflict_dismissals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_googleId_key" ON "users"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "preference_profiles_userId_key" ON "preference_profiles"("userId");

-- CreateIndex
CREATE INDEX "group_members_userId_idx" ON "group_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "group_members_groupId_userId_key" ON "group_members"("groupId", "userId");

-- CreateIndex
CREATE INDEX "meetings_groupId_idx" ON "meetings"("groupId");

-- CreateIndex
CREATE INDEX "meetings_status_currentDatetime_idx" ON "meetings"("status", "currentDatetime");

-- CreateIndex
CREATE INDEX "match_runs_meetingId_idx" ON "match_runs"("meetingId");

-- CreateIndex
CREATE UNIQUE INDEX "match_runs_meetingId_cycleNumber_key" ON "match_runs"("meetingId", "cycleNumber");

-- CreateIndex
CREATE UNIQUE INDEX "match_options_matchRunId_rank_key" ON "match_options"("matchRunId", "rank");

-- CreateIndex
CREATE INDEX "responses_userId_idx" ON "responses"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "responses_meetingId_userId_key" ON "responses"("meetingId", "userId");

-- CreateIndex
CREATE INDEX "participant_meeting_contexts_meetingId_userId_createdAt_idx" ON "participant_meeting_contexts"("meetingId", "userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "conflict_dismissals_userId_meetingAId_meetingBId_key" ON "conflict_dismissals"("userId", "meetingAId", "meetingBId");

-- AddForeignKey
ALTER TABLE "preference_profiles" ADD CONSTRAINT "preference_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_initiatorId_fkey" FOREIGN KEY ("initiatorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_runs" ADD CONSTRAINT "match_runs_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_options" ADD CONSTRAINT "match_options_matchRunId_fkey" FOREIGN KEY ("matchRunId") REFERENCES "match_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "responses" ADD CONSTRAINT "responses_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "responses" ADD CONSTRAINT "responses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_meeting_contexts" ADD CONSTRAINT "participant_meeting_contexts_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_meeting_contexts" ADD CONSTRAINT "participant_meeting_contexts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_run_seen_contexts" ADD CONSTRAINT "match_run_seen_contexts_matchRunId_fkey" FOREIGN KEY ("matchRunId") REFERENCES "match_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_run_seen_contexts" ADD CONSTRAINT "match_run_seen_contexts_contextId_fkey" FOREIGN KEY ("contextId") REFERENCES "participant_meeting_contexts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict_dismissals" ADD CONSTRAINT "conflict_dismissals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict_dismissals" ADD CONSTRAINT "conflict_dismissals_meetingAId_fkey" FOREIGN KEY ("meetingAId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict_dismissals" ADD CONSTRAINT "conflict_dismissals_meetingBId_fkey" FOREIGN KEY ("meetingBId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

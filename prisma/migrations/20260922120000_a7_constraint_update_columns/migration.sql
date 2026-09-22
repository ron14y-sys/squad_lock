-- A7 (Constraint Updater).
--
-- Two additions, both nullable, so this migration is additive and reversible
-- without touching a row:
--
--   1. Where a rejection lands. A free-text rejection becomes a per-meeting
--      correction on the rejecting participant's context row, in the
--      SoftPreferences vocabulary — never an edit to the profile, because
--      "too expensive this time" does not make somebody permanently thrifty
--      (spec §3.2, issue #86). The type has existed in lib/types/meeting.ts
--      since F3 with no column behind it; this is the column.
--
--      Nullable with no default rather than DEFAULT '{}': NULL is "no
--      correction", which is what every amendment row carries, while {} would
--      read as "corrected to nothing". tasks/todo.md's B11 line sketched the
--      default; the type that has to be read back says otherwise.
--
--   2. What A7 made of the text, or why it made nothing of it. Recorded as a
--      fact rather than a sentence, on the same rule as match_options
--      .unverified above: the Hebrew line a person reads is rendered at
--      display time by lib/format/hebrew-labels.ts.
--
--      One enum covers both axes because they are mutually exclusive — either
--      something was extracted, or it was not and there is exactly one reason.
--      Without it, "the model found nothing" and "the call died" are the same
--      row, and they need different fixes from us (tasks/a7-plan.md, decision
--      5).

-- CreateEnum
CREATE TYPE "ExtractionOutcome" AS ENUM ('soft', 'distance', 'time', 'venue_identity', 'none', 'failed_quota', 'failed_timeout', 'failed_invalid');

-- AlterTable
ALTER TABLE "participant_meeting_contexts" ADD COLUMN     "softPreferences" JSONB;

-- AlterTable
ALTER TABLE "responses" ADD COLUMN     "extractionOutcome" "ExtractionOutcome";

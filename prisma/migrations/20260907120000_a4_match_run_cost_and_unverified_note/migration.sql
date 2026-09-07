-- A4 (Group Matching Agent).
--
-- Two additions, both nullable, so this migration is additive and reversible
-- without touching a row:
--
--   1. What a matching run cost. docs/decisions/llm-client.md recorded that
--      these columns belong with whatever creates a run, and A4 is what does.
--      A5 totals cost per eval scenario from them, and spec §6.4 wants a
--      cost-per-decision figure for the report — both read the number back,
--      so a log line is not enough. "costUsd" stays NULL rather than 0 for an
--      unpriced model; "costBasis" says how far to trust it.
--
--   2. What A2 could not verify about an option, as the structured
--      UnverifiedFact[] the filter produced. Written by code, never by the
--      model, and shown to everybody — the opposite of "tradeoffs", which
--      nobody is ever shown (docs/decisions/hard-constraints.md, spec §5.6).
--      The *sentence* is rendered from this at display time by
--      lib/format/hebrew-labels.ts: the app is Hebrew and RTL, so freezing
--      rendered English text in a column would make every row a translation.

-- AlterTable
ALTER TABLE "match_runs" ADD COLUMN     "model" TEXT,
ADD COLUMN     "thinkingLevel" TEXT,
ADD COLUMN     "durationMs" INTEGER,
ADD COLUMN     "inputTokens" INTEGER,
ADD COLUMN     "outputTokens" INTEGER,
ADD COLUMN     "thoughtTokens" INTEGER,
ADD COLUMN     "cachedTokens" INTEGER,
ADD COLUMN     "costUsd" DECIMAL(12,8),
ADD COLUMN     "costBasis" TEXT;

--   3. When an option ends. A meeting shortens to fit a venue's opening hours
--      (B6), so the end is a real answer rather than an implied one — eval
--      scenario 07's expected answer is "until midnight, because the bar
--      shuts". Added with a default so the column can be NOT NULL on a table
--      that is empty today; B6 sets it from the trimmed slot.

-- AlterTable
ALTER TABLE "match_options" ADD COLUMN     "unverified" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "proposedEnd" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

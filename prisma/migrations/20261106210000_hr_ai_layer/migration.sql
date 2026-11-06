-- لایهٔ مدل زبانی — Stage 2.
--
-- Two tables: the call ledger (one row per model call, for reproducibility) and
-- the last reading of a text collection (surveys, «صدای من»). The candidate
-- gains the CV text and the model's proposal; neither changes stage or ranking.

CREATE TABLE "HrAiCall" (
  "id" TEXT NOT NULL,
  "feature" TEXT NOT NULL,
  "userId" TEXT,
  "inputHash" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'offline',
  "model" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'OK',
  "error" TEXT NOT NULL DEFAULT '',
  "outputText" TEXT NOT NULL DEFAULT '',
  "tokensIn" INTEGER NOT NULL DEFAULT 0,
  "tokensOut" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HrAiCall_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HrAiCall_feature_createdAt_idx" ON "HrAiCall"("feature", "createdAt");
CREATE INDEX "HrAiCall_userId_createdAt_idx" ON "HrAiCall"("userId", "createdAt");

CREATE TABLE "HrTextInsight" (
  "id" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "refId" TEXT NOT NULL DEFAULT '',
  "summary" TEXT NOT NULL DEFAULT '',
  "themes" JSONB NOT NULL DEFAULT '[]',
  "count" INTEGER NOT NULL DEFAULT 0,
  "provider" TEXT NOT NULL DEFAULT '',
  "model" TEXT NOT NULL DEFAULT '',
  "createdBy" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HrTextInsight_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HrTextInsight_scope_refId_createdAt_idx" ON "HrTextInsight"("scope", "refId", "createdAt");

ALTER TABLE "HrCandidate" ADD COLUMN "cvText" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HrCandidate" ADD COLUMN "cvFileName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HrCandidate" ADD COLUMN "cvSummary" JSONB;
ALTER TABLE "HrCandidate" ADD COLUMN "cvAnalyzedAt" TIMESTAMP(3);

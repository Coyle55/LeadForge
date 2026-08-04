CREATE TYPE "OpportunityAnalysisStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "RecommendationLevel" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

CREATE TABLE "OpportunityAnalysis" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "prospectId" TEXT NOT NULL,
  "auditId" TEXT NOT NULL,
  "status" "OpportunityAnalysisStatus" NOT NULL DEFAULT 'RUNNING',
  "overallScore" INTEGER,
  "categoryScores" JSONB,
  "executiveSummary" TEXT,
  "overallRationale" TEXT,
  "model" TEXT NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "inputTokens" INTEGER,
  "outputTokens" INTEGER,
  "durationMs" INTEGER,
  "failureCode" TEXT,
  "failureMessage" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OpportunityAnalysis_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OpportunityRecommendation" (
  "id" TEXT NOT NULL,
  "analysisId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "impact" "RecommendationLevel" NOT NULL,
  "effort" "RecommendationLevel" NOT NULL,
  "rationale" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "auditCheckKeys" JSONB NOT NULL,
  CONSTRAINT "OpportunityRecommendation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OpportunityAnalysis_userId_createdAt_idx" ON "OpportunityAnalysis"("userId", "createdAt");
CREATE INDEX "OpportunityAnalysis_userId_prospectId_createdAt_idx" ON "OpportunityAnalysis"("userId", "prospectId", "createdAt");
CREATE INDEX "OpportunityAnalysis_userId_auditId_createdAt_idx" ON "OpportunityAnalysis"("userId", "auditId", "createdAt");
CREATE UNIQUE INDEX "OpportunityRecommendation_analysisId_position_key" ON "OpportunityRecommendation"("analysisId", "position");
CREATE INDEX "OpportunityRecommendation_analysisId_impact_idx" ON "OpportunityRecommendation"("analysisId", "impact");
ALTER TABLE "OpportunityRecommendation" ADD CONSTRAINT "OpportunityRecommendation_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "OpportunityAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

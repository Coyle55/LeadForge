ALTER TYPE "OutreachDraftStatus" ADD VALUE 'SENT';

CREATE TYPE "OpportunityTier" AS ENUM ('EXCELLENT', 'HIGH', 'MEDIUM', 'LOW');
CREATE TYPE "ScoringConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');
CREATE TYPE "ScoringMethod" AS ENUM ('AI_LEGACY', 'DETERMINISTIC');
CREATE TYPE "ServiceCategory" AS ENUM ('WEBSITE_REDESIGN', 'PERFORMANCE_OPTIMIZATION', 'BOOKING_INTEGRATION', 'LEAD_CAPTURE_REPAIR', 'LEAD_RESPONSE_AUTOMATION');
CREATE TYPE "BusinessCategory" AS ENUM ('SALON_SPA', 'MEDICAL_DENTAL', 'HOME_SERVICES', 'AUTOMOTIVE', 'FITNESS', 'LEGAL_FINANCIAL', 'RESTAURANT_FOOD', 'RETAIL', 'PROFESSIONAL_SERVICES', 'OTHER');
CREATE TYPE "ProspectActivityType" AS ENUM ('OUTREACH_SENT');

ALTER TABLE "OpportunityAnalysis"
  ADD COLUMN "tier" "OpportunityTier",
  ADD COLUMN "scoringBreakdown" JSONB,
  ADD COLUMN "topReasons" JSONB,
  ADD COLUMN "disqualifiers" JSONB,
  ADD COLUMN "strongestIssue" TEXT,
  ADD COLUMN "suggestedOffer" TEXT,
  ADD COLUMN "confidence" "ScoringConfidence",
  ADD COLUMN "warnings" JSONB,
  ADD COLUMN "scoringMethod" "ScoringMethod" NOT NULL DEFAULT 'DETERMINISTIC';

UPDATE "OpportunityAnalysis" SET "scoringMethod" = 'AI_LEGACY' WHERE "status" = 'COMPLETED';

ALTER TABLE "OpportunityRecommendation"
  ADD COLUMN "serviceCategory" "ServiceCategory",
  ADD COLUMN "confidence" "ScoringConfidence";

ALTER TABLE "Prospect"
  ADD COLUMN "businessCategory" "BusinessCategory",
  ADD COLUMN "lastContactedAt" TIMESTAMP(3);

ALTER TABLE "WebsiteAudit"
  ADD COLUMN "screenshotUrl" TEXT,
  ADD COLUMN "screenshotStatus" TEXT;

ALTER TABLE "OutreachDraft"
  ADD COLUMN "sentAt" TIMESTAMP(3),
  ADD COLUMN "sentSubject" TEXT,
  ADD COLUMN "sentBody" TEXT;

CREATE TABLE "ProspectActivity" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "prospectId" TEXT NOT NULL,
  "type" "ProspectActivityType" NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  CONSTRAINT "ProspectActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProspectActivity_userId_prospectId_occurredAt_idx" ON "ProspectActivity"("userId", "prospectId", "occurredAt");

ALTER TABLE "ProspectActivity"
  ADD CONSTRAINT "ProspectActivity_prospectId_fkey"
  FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

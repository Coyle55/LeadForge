CREATE TYPE "OutreachDraftStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

CREATE TABLE "OutreachProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "senderName" TEXT NOT NULL,
  "companyName" TEXT NOT NULL,
  "serviceOffered" TEXT NOT NULL,
  "valueProposition" TEXT NOT NULL,
  "defaultCta" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OutreachProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutreachDraft" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "prospectId" TEXT NOT NULL,
  "analysisId" TEXT NOT NULL,
  "recommendationId" TEXT NOT NULL,
  "status" "OutreachDraftStatus" NOT NULL DEFAULT 'RUNNING',
  "recipientName" TEXT NOT NULL,
  "recipientEmail" TEXT NOT NULL,
  "businessName" TEXT NOT NULL,
  "websiteHostname" TEXT NOT NULL,
  "recommendationTitle" TEXT NOT NULL,
  "generatedSubject" TEXT,
  "generatedBody" TEXT,
  "subject" TEXT,
  "body" TEXT,
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
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OutreachDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OutreachProfile_userId_key" ON "OutreachProfile"("userId");
CREATE INDEX "OutreachDraft_userId_createdAt_idx" ON "OutreachDraft"("userId", "createdAt");
CREATE INDEX "OutreachDraft_userId_prospectId_createdAt_idx" ON "OutreachDraft"("userId", "prospectId", "createdAt");
CREATE INDEX "OutreachDraft_userId_analysisId_createdAt_idx" ON "OutreachDraft"("userId", "analysisId", "createdAt");
CREATE INDEX "OutreachDraft_userId_recommendationId_createdAt_idx" ON "OutreachDraft"("userId", "recommendationId", "createdAt");

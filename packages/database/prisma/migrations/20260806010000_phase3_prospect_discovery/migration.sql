ALTER TABLE "Prospect"
  ADD COLUMN "sourceProvider" TEXT,
  ADD COLUMN "sourceExternalId" TEXT,
  ADD COLUMN "sourceUrls" JSONB;

CREATE TABLE "ProspectImportBatch" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "reasoningModel" TEXT NOT NULL,
  "query" TEXT NOT NULL,
  "location" TEXT NOT NULL,
  "requestedCount" INTEGER NOT NULL,
  "returnedCount" INTEGER NOT NULL,
  "importedCount" INTEGER NOT NULL,
  "skippedCount" INTEGER NOT NULL,
  "failedCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProspectImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProspectImportBatch_userId_createdAt_idx" ON "ProspectImportBatch"("userId", "createdAt");

CREATE TABLE "ProspectDiscoveryCache" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "cacheKey" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "inputTokens" INTEGER,
  "outputTokens" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProspectDiscoveryCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProspectDiscoveryCache_userId_cacheKey_key" ON "ProspectDiscoveryCache"("userId", "cacheKey");

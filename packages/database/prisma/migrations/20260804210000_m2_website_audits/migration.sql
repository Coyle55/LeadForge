CREATE TYPE "WebsiteAuditStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "AuditCheckStatus" AS ENUM ('PASS', 'WARNING', 'FAIL');
CREATE TYPE "AuditCheckCategory" AS ENUM ('ACCESSIBILITY', 'TRUST', 'SEO', 'TECHNICAL', 'PERFORMANCE');

CREATE TABLE "WebsiteAudit" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "prospectId" TEXT NOT NULL,
  "requestedUrl" TEXT NOT NULL,
  "finalUrl" TEXT,
  "status" "WebsiteAuditStatus" NOT NULL DEFAULT 'RUNNING',
  "failureCode" TEXT,
  "failureMessage" TEXT,
  "pagesAttempted" INTEGER NOT NULL DEFAULT 0,
  "pagesAudited" INTEGER NOT NULL DEFAULT 0,
  "durationMs" INTEGER,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebsiteAudit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditCheck" (
  "id" TEXT NOT NULL,
  "auditId" TEXT NOT NULL,
  "category" "AuditCheckCategory" NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "status" "AuditCheckStatus" NOT NULL,
  "summary" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  CONSTRAINT "AuditCheck_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebsiteAudit_userId_createdAt_idx" ON "WebsiteAudit"("userId", "createdAt");
CREATE INDEX "WebsiteAudit_userId_prospectId_createdAt_idx" ON "WebsiteAudit"("userId", "prospectId", "createdAt");
CREATE UNIQUE INDEX "AuditCheck_auditId_key_key" ON "AuditCheck"("auditId", "key");
CREATE INDEX "AuditCheck_auditId_category_status_idx" ON "AuditCheck"("auditId", "category", "status");
ALTER TABLE "AuditCheck" ADD CONSTRAINT "AuditCheck_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "WebsiteAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

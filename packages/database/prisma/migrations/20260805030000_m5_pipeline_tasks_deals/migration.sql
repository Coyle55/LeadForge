CREATE TYPE "PipelineStage" AS ENUM ('NEW', 'CONTACTED', 'INTERESTED', 'PROPOSAL', 'WON', 'LOST');
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'COMPLETED');

ALTER TABLE "Prospect"
  ADD COLUMN "pipelineStage" "PipelineStage" NOT NULL DEFAULT 'NEW',
  ADD COLUMN "archivedAt" TIMESTAMP(3);

UPDATE "Prospect"
SET "pipelineStage" = CASE "status"
  WHEN 'QUALIFIED' THEN 'INTERESTED'::"PipelineStage"
  ELSE 'NEW'::"PipelineStage"
END;

WITH migration_clock AS (
  SELECT CURRENT_TIMESTAMP AS captured_at
)
UPDATE "Prospect"
SET "archivedAt" = migration_clock.captured_at
FROM migration_clock
WHERE "status" = 'ARCHIVED';

DROP INDEX "Prospect_userId_status_idx";

ALTER TABLE "Prospect" DROP COLUMN "status";

DROP TYPE "ProspectStatus";

CREATE TABLE "Deal" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "prospectId" TEXT NOT NULL,
  "valueCents" INTEGER,
  "expectedCloseDate" TIMESTAMP(3),
  "actualCloseDate" TIMESTAMP(3),
  "lossReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Task" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "prospectId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
  "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Deal_prospectId_key" ON "Deal"("prospectId");
CREATE INDEX "Deal_userId_expectedCloseDate_idx" ON "Deal"("userId", "expectedCloseDate");
CREATE INDEX "Prospect_userId_archivedAt_idx" ON "Prospect"("userId", "archivedAt");
CREATE INDEX "Prospect_userId_pipelineStage_idx" ON "Prospect"("userId", "pipelineStage");
CREATE INDEX "Task_userId_status_dueAt_idx" ON "Task"("userId", "status", "dueAt");
CREATE INDEX "Task_userId_prospectId_status_dueAt_idx" ON "Task"("userId", "prospectId", "status", "dueAt");
CREATE INDEX "Task_userId_priority_status_idx" ON "Task"("userId", "priority", "status");

ALTER TABLE "Deal"
  ADD CONSTRAINT "Deal_prospectId_fkey"
  FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Task"
  ADD CONSTRAINT "Task_prospectId_fkey"
  FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

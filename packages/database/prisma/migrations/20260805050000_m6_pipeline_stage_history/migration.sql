CREATE TABLE "PipelineStageChange" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "prospectId" TEXT NOT NULL,
  "fromStage" "PipelineStage",
  "toStage" "PipelineStage" NOT NULL,
  "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PipelineStageChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PipelineStageChange_userId_prospectId_changedAt_idx" ON "PipelineStageChange"("userId", "prospectId", "changedAt");
CREATE INDEX "PipelineStageChange_userId_toStage_changedAt_idx" ON "PipelineStageChange"("userId", "toStage", "changedAt");

ALTER TABLE "PipelineStageChange"
  ADD CONSTRAINT "PipelineStageChange_prospectId_fkey"
  FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

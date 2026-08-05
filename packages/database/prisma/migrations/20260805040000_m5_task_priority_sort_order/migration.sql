ALTER TABLE "Task" ALTER COLUMN "priority" DROP DEFAULT;

ALTER TYPE "TaskPriority" RENAME TO "TaskPriority_old";
CREATE TYPE "TaskPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

ALTER TABLE "Task"
  ALTER COLUMN "priority" TYPE "TaskPriority"
  USING ("priority"::TEXT::"TaskPriority");

ALTER TABLE "Task" ALTER COLUMN "priority" SET DEFAULT 'MEDIUM';
DROP TYPE "TaskPriority_old";

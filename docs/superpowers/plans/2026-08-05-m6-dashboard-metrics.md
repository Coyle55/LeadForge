# M6 Dashboard Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `PipelineStageChange` history log and a new owner-scoped `/reports` page showing pipeline funnel/conversion, win rate and revenue trend, and task/activity trends over the trailing 12 months.

**Architecture:** Log every stage transition (including creation) inside the same Prisma transaction as the existing mutation, so the log can never drift from `Prospect.pipelineStage`. `/reports` is a read-only Server Component that aggregates via owner-scoped Prisma queries at request time — no caching layer, no new dependency, no scheduler. Charts reuse the existing `recharts`-based `packages/design-system/components/ui/chart.tsx` wrapper.

**Tech Stack:** Next.js 16 App Router, React 19 Server Components, Clerk, Prisma 7 with `@prisma/adapter-pg`, PostgreSQL, Vitest 4, Bun, Biome/Ultracite, Recharts (already a design-system dependency)

## Global Constraints

- `PipelineStageChange` fields: `id`, `userId`, `prospectId`, `fromStage: PipelineStage?` (null only for the creation event), `toStage: PipelineStage`, `changedAt: DateTime`.
- The history write and the stage/creation mutation it accompanies are always in the same Prisma transaction — never write one without the other.
- No retroactive history: existing prospects get no backfilled log rows. This is a stated, accepted limitation.
- `/reports` performs no mutations. All queries are owner-scoped from `auth()`; never trust a client-submitted owner ID.
- Trend charts use monthly buckets in UTC over the trailing 12 months (this does not use the fixed `America/New_York` product timezone — that timezone applies only to M5's Task due-today/overdue boundaries, which are unaffected by this milestone).
- Stage funnel = active (non-archived) prospects only, stages `NEW | CONTACTED | INTERESTED | PROPOSAL`. `WON`/`LOST` are terminal totals, not funnel bars.
- Stage conversion rate = `reached(B) ÷ reached(A)` using the history log, for each adjacent pair in the fixed sequence; includes archived prospects; `null` when `reached(A)` is 0.
- Win rate = `won ÷ (won + lost)` in the trailing 12 months. Won uses `Deal.actualCloseDate`; Lost uses the most recent `PipelineStageChange` row with `toStage: "LOST"` for prospects currently in the `LOST` stage (Deal has no lost-date field).
- Every metric zero-fills months with no data; a category with zero data across the whole window renders an explicit empty state, not an empty/misleading chart.
- No date-range filtering, CSV/export, drill-down views, real-time updates, time-in-stage metric, stalled-prospect flagging, or custom report builder in this milestone.
- Do not touch production-hardening scope (monitoring, error tracking, security review) — that is a separate future spec.

---

### Task 1: PipelineStageChange schema and migration

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260805050000_m6_pipeline_stage_history/migration.sql`

**Interfaces:**
- Produces: Prisma `PipelineStageChange` model and its generated client type, importable from `@repo/database`.

- [ ] **Step 1: Add the model to schema.prisma**

Add the enum-typed model, and the back-relation array on `Prospect` (matching the existing `tasks Task[]` pattern):

```prisma
model PipelineStageChange {
  id         String         @id @default(cuid())
  userId     String
  prospectId String
  fromStage  PipelineStage?
  toStage    PipelineStage
  changedAt  DateTime       @default(now())
  prospect   Prospect       @relation(fields: [prospectId], references: [id], onDelete: Cascade)

  @@index([userId, prospectId, changedAt])
  @@index([userId, toStage, changedAt])
}
```

In `model Prospect`, add `stageChanges PipelineStageChange[]` alongside the existing `deal` and `tasks` fields.

- [ ] **Step 2: Format and validate the schema**

Run:

```bash
cd packages/database && bunx prisma format && bunx prisma validate && bunx prisma generate
```

Expected: schema is valid and the generated client now exports `PipelineStageChange`.

- [ ] **Step 3: Write the migration SQL by hand**

Create `packages/database/prisma/migrations/20260805050000_m6_pipeline_stage_history/migration.sql`:

```sql
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
```

- [ ] **Step 4: Commit**

```bash
git add packages/database/prisma
git commit -m "feat: add pipeline stage history persistence"
```

---

### Task 2: Record stage transitions atomically

**Files:**
- Modify: `apps/app/app/actions/prospects.ts:92-127` (`createProspect`)
- Modify: `apps/app/app/actions/prospects.test.ts:1-100`
- Modify: `apps/app/app/actions/pipeline.ts:240-287` (`executeMoveTransaction`)
- Modify: `apps/app/app/actions/pipeline.test.ts`

**Interfaces:**
- Consumes: `database.pipelineStageChange.create` (Prisma, from Task 1's model).
- Produces: no new exported names — `createProspect` and `moveProspectStage` keep their existing signatures and return types.

- [ ] **Step 1: Write failing tests for the creation history write**

In `apps/app/app/actions/prospects.test.ts`, replace the `database` mock and transaction setup:

```ts
const createMock = vi.fn();
const updateManyMock = vi.fn();
const stageChangeCreateMock = vi.fn();
const transactionMock = vi.fn();

vi.mock("@repo/database", () => ({
  database: {
    $transaction: transactionMock,
    prospect: { updateMany: updateManyMock },
  },
}));
```

In `beforeEach`, add:

```ts
transactionMock.mockImplementation(
  async (
    callback: (client: {
      pipelineStageChange: { create: typeof stageChangeCreateMock };
      prospect: { create: typeof createMock };
    }) => unknown
  ) =>
    await callback({
      prospect: { create: createMock },
      pipelineStageChange: { create: stageChangeCreateMock },
    })
);
```

Update the two existing create-path assertions:

```ts
it("denies signed-out and non-owner creation without writing", async () => {
  const { createProspect } = await import("./prospects");
  authMock.mockResolvedValueOnce({ userId: null });
  await expect(createProspect({}, form(valid))).resolves.toMatchObject({
    status: "error",
  });
  authMock.mockResolvedValueOnce({ userId: "user_other" });
  await expect(createProspect({}, form(valid))).resolves.toMatchObject({
    status: "error",
  });
  expect(transactionMock).not.toHaveBeenCalled();
});

it("creates for the authenticated owner, normalizes fields, and logs the initial stage", async () => {
  authMock.mockResolvedValue({ userId: "user_owner" });
  createMock.mockResolvedValue({ id: "prospect_1" });
  const { createProspect } = await import("./prospects");

  await createProspect({}, form({ ...valid, userId: "user_victim" }));
  expect(createMock).toHaveBeenCalledWith({
    data: {
      userId: "user_owner",
      businessName: "Acme Plumbing",
      websiteUrl: "https://acme.example",
      contactName: "Ada",
      contactEmail: "owner@example.com",
      phone: null,
      location: "Boston",
      notes: null,
    },
  });
  expect(stageChangeCreateMock).toHaveBeenCalledWith({
    data: {
      userId: "user_owner",
      prospectId: "prospect_1",
      fromStage: null,
      toStage: "NEW",
    },
  });
  expect(redirectMock).toHaveBeenCalledWith(
    "/prospects/prospect_1?created=1"
  );
  expect(revalidatePathMock).toHaveBeenCalledWith("/prospects");
  expect(revalidatePathMock).toHaveBeenCalledWith("/pipeline");
});
```

Remove the old `createMock`-only assertions these two tests replace; leave every other test in the file untouched (they exercise `updateProspect`/`archiveProspect`, which are unaffected).

- [ ] **Step 2: Run tests and verify RED**

Run: `bun test apps/app/app/actions/prospects.test.ts`  
Expected: FAIL — `createProspect` still calls `database.prospect.create` directly, so `transactionMock`/`stageChangeCreateMock` are never invoked.

- [ ] **Step 3: Wrap prospect creation in a transaction**

In `apps/app/app/actions/prospects.ts`, replace the body of the `try` block in `createProspect`:

```ts
let prospectId: string;
try {
  const prospect = await database.$transaction(async (transaction) => {
    const created = await transaction.prospect.create({
      data: { userId, ...parsed.data },
    });
    await transaction.pipelineStageChange.create({
      data: {
        userId,
        prospectId: created.id,
        fromStage: null,
        toStage: "NEW",
      },
    });
    return created;
  });
  prospectId = prospect.id;
} catch {
  safeErrorLog("prospect.create.failed", { userId });
  return { status: "error", message: "Unable to save prospect." };
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run: `bun test apps/app/app/actions/prospects.test.ts`  
Expected: PASS.

- [ ] **Step 5: Write failing test for the stage-move history write**

In `apps/app/app/actions/pipeline.test.ts`, add `pipelineStageChange: { create: vi.fn() }` to the `transaction` object and its mock declarations:

```ts
const stageChangeCreateMock = vi.fn();
const transaction = {
  deal: {
    create: dealCreateMock,
    findFirst: dealFindFirstMock,
    updateMany: dealUpdateManyMock,
  },
  pipelineStageChange: { create: stageChangeCreateMock },
  prospect: {
    findFirst: prospectFindFirstMock,
    updateMany: prospectUpdateManyMock,
  },
};
```

Add a new test near the existing successful-move test:

```ts
it("records the stage transition atomically with the move", async () => {
  authMock.mockResolvedValue({ userId: "user_owner" });
  prospectFindFirstMock.mockResolvedValue({
    id: "prospect_1",
    pipelineStage: "PROPOSAL",
  });
  dealFindFirstMock.mockResolvedValue(null);
  const { moveProspectStage } = await import("./pipeline");

  await moveProspectStage(
    {},
    form({ destination: "INTERESTED", prospectId: "prospect_1" })
  );

  expect(stageChangeCreateMock).toHaveBeenCalledWith({
    data: {
      userId: "user_owner",
      prospectId: "prospect_1",
      fromStage: "PROPOSAL",
      toStage: "INTERESTED",
    },
  });
});
```

- [ ] **Step 6: Run test and verify RED**

Run: `bun test apps/app/app/actions/pipeline.test.ts`  
Expected: FAIL — `stageChangeCreateMock` is never called.

- [ ] **Step 7: Write the history row inside `executeMoveTransaction`**

In `apps/app/app/actions/pipeline.ts`, inside the `database.$transaction` callback in `executeMoveTransaction`, after the `prospect.updateMany` result check succeeds and before `return "success" as const;`:

```ts
const result = await transaction.prospect.updateMany({
  where: {
    id: prospect.id,
    userId,
    archivedAt: null,
    pipelineStage: prospect.pipelineStage,
  },
  data: { pipelineStage: transition.destination },
});
if (result.count !== 1) {
  throw new MutationRaceError();
}

await transaction.pipelineStageChange.create({
  data: {
    userId,
    prospectId: prospect.id,
    fromStage: prospect.pipelineStage,
    toStage: transition.destination,
  },
});

return "success" as const;
```

- [ ] **Step 8: Run tests and verify GREEN**

Run: `bun test apps/app/app/actions/pipeline.test.ts apps/app/app/actions/prospects.test.ts`  
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/app/app/actions/prospects.ts apps/app/app/actions/prospects.test.ts apps/app/app/actions/pipeline.ts apps/app/app/actions/pipeline.test.ts
git commit -m "feat: record pipeline stage transitions"
```

---

### Task 3: Month-bucketing helpers

**Files:**
- Create: `apps/app/app/lib/reports/months.ts`
- Create: `apps/app/app/lib/reports/months.test.ts`

**Interfaces:**
- Produces: `MonthBucket` (`{ start: Date; end: Date; key: string; label: string }`), `getTrailingMonths(now: Date, count: number): MonthBucket[]`, `sumByMonth<T>(months: MonthBucket[], items: T[], getDate: (item: T) => Date, getValue?: (item: T) => number): number[]`.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import { getTrailingMonths, sumByMonth } from "./months";

describe("getTrailingMonths", () => {
  it("returns UTC month buckets ending with the current month, oldest first", () => {
    const months = getTrailingMonths(new Date("2026-08-05T12:00:00.000Z"), 3);
    expect(months.map((m) => m.key)).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(months.map((m) => m.label)).toEqual([
      "Jun 2026",
      "Jul 2026",
      "Aug 2026",
    ]);
    expect(months[2].start).toEqual(new Date("2026-08-01T00:00:00.000Z"));
    expect(months[2].end).toEqual(new Date("2026-09-01T00:00:00.000Z"));
  });

  it("crosses a year boundary correctly", () => {
    const months = getTrailingMonths(new Date("2026-01-15T00:00:00.000Z"), 2);
    expect(months.map((m) => m.key)).toEqual(["2025-12", "2026-01"]);
  });
});

describe("sumByMonth", () => {
  const months = getTrailingMonths(new Date("2026-08-05T00:00:00.000Z"), 2);

  it("counts items per month by default", () => {
    const items = [
      { at: new Date("2026-07-10T00:00:00.000Z") },
      { at: new Date("2026-08-01T00:00:00.000Z") },
      { at: new Date("2026-08-20T00:00:00.000Z") },
    ];
    expect(sumByMonth(months, items, (item) => item.at)).toEqual([1, 2]);
  });

  it("sums a custom value and ignores dates outside every bucket", () => {
    const items = [
      { at: new Date("2026-07-10T00:00:00.000Z"), value: 500 },
      { at: new Date("2026-08-01T00:00:00.000Z"), value: 250 },
      { at: new Date("2026-01-01T00:00:00.000Z"), value: 999 },
    ];
    expect(
      sumByMonth(
        months,
        items,
        (item) => item.at,
        (item) => item.value
      )
    ).toEqual([500, 250]);
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `bun test apps/app/app/lib/reports/months.test.ts`  
Expected: FAIL because `./months` does not exist.

- [ ] **Step 3: Implement the helpers**

```ts
export interface MonthBucket {
  end: Date;
  key: string;
  label: string;
  start: Date;
}

const MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

export const getTrailingMonths = (
  now: Date,
  count: number
): MonthBucket[] => {
  const months: MonthBucket[] = [];
  const currentMonthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);

  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const start = new Date(
      Date.UTC(1970, 0, 1) +
        (currentMonthStart - Date.UTC(1970, 0, 1))
    );
    start.setUTCMonth(start.getUTCMonth() - offset);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);

    months.push({
      start,
      end,
      key: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`,
      label: MONTH_LABEL_FORMATTER.format(start),
    });
  }

  return months;
};

export const sumByMonth = <T>(
  months: MonthBucket[],
  items: T[],
  getDate: (item: T) => Date,
  getValue: (item: T) => number = () => 1
): number[] => {
  const totals = new Array(months.length).fill(0);
  for (const item of items) {
    const date = getDate(item);
    const index = months.findIndex(
      (month) => date >= month.start && date < month.end
    );
    if (index !== -1) {
      totals[index] += getValue(item);
    }
  }
  return totals;
};
```

- [ ] **Step 4: Run tests and verify GREEN**

Run: `bun test apps/app/app/lib/reports/months.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/app/app/lib/reports
git commit -m "feat: add reports month bucketing helpers"
```

---

### Task 4: Reports metrics queries

**Files:**
- Create: `apps/app/app/(authenticated)/reports/queries.ts`
- Create: `apps/app/app/(authenticated)/reports/queries.test.ts`

**Interfaces:**
- Consumes: `getTrailingMonths`, `sumByMonth`, `MonthBucket` from `../../lib/reports/months` (Task 3).
- Produces: `FunnelStageCount`, `StageConversion`, `MonthlyPoint`, `RevenuePoint`, `TaskTrendPoint`, `ActivityTrendPoint`, `ReportsMetrics`, and `getReportsMetrics(userId: string, now?: Date): Promise<ReportsMetrics>`.

- [ ] **Step 1: Write failing tests**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const prospectCountMock = vi.fn();
const stageChangeFindManyMock = vi.fn();
const dealFindManyMock = vi.fn();
const dealCountMock = vi.fn();
const taskFindManyMock = vi.fn();
const websiteAuditFindManyMock = vi.fn();
const outreachDraftFindManyMock = vi.fn();

vi.mock("@repo/database", () => ({
  database: {
    deal: { count: dealCountMock, findMany: dealFindManyMock },
    outreachDraft: { findMany: outreachDraftFindManyMock },
    pipelineStageChange: { findMany: stageChangeFindManyMock },
    prospect: { count: prospectCountMock },
    task: { findMany: taskFindManyMock },
    websiteAudit: { findMany: websiteAuditFindManyMock },
  },
}));

const now = new Date("2026-08-05T12:00:00.000Z");

describe("getReportsMetrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prospectCountMock.mockResolvedValue(0);
    stageChangeFindManyMock.mockResolvedValue([]);
    dealFindManyMock.mockResolvedValue([]);
    dealCountMock.mockResolvedValue(0);
    taskFindManyMock.mockResolvedValue([]);
    websiteAuditFindManyMock.mockResolvedValue([]);
    outreachDraftFindManyMock.mockResolvedValue([]);
  });

  it("computes null conversion and win rates when there is no history", async () => {
    const { getReportsMetrics } = await import("./queries");

    const metrics = await getReportsMetrics("user_owner", now);

    expect(metrics.conversionRates.every((c) => c.rate === null)).toBe(true);
    expect(metrics.winRate).toBeNull();
    expect(metrics.revenueTrend).toHaveLength(12);
    expect(metrics.revenueTrend.every((point) => point.valueCents === 0)).toBe(
      true
    );
  });

  it("computes stage-to-stage conversion from distinct reached prospects", async () => {
    stageChangeFindManyMock.mockImplementation(({ where }) => {
      const counts: Record<string, number> = {
        NEW: 10,
        CONTACTED: 6,
        INTERESTED: 3,
        PROPOSAL: 1,
      };
      return Promise.resolve(
        Array.from({ length: counts[where.toStage] ?? 0 }, (_, index) => ({
          prospectId: `prospect_${where.toStage}_${index}`,
        }))
      );
    });
    const { getReportsMetrics } = await import("./queries");

    const metrics = await getReportsMetrics("user_owner", now);

    expect(metrics.conversionRates).toEqual([
      { from: "NEW", to: "CONTACTED", rate: 0.6 },
      { from: "CONTACTED", to: "INTERESTED", rate: 0.5 },
      { from: "INTERESTED", to: "PROPOSAL", rate: 1 / 3 },
    ]);
  });

  it("combines won deals and the most recent Lost transitions for win rate", async () => {
    dealCountMock.mockResolvedValue(3);
    stageChangeFindManyMock.mockImplementation(({ where }) => {
      if (where.toStage === "LOST") {
        return Promise.resolve([
          { changedAt: new Date("2026-07-01T00:00:00.000Z") },
        ]);
      }
      return Promise.resolve([]);
    });
    const { getReportsMetrics } = await import("./queries");

    const metrics = await getReportsMetrics("user_owner", now);

    expect(metrics.winRate).toBe(0.75);
  });

  it("zero-fills months with no won revenue and sums cents by close-date month", async () => {
    dealFindManyMock.mockResolvedValue([
      {
        actualCloseDate: new Date("2026-08-02T00:00:00.000Z"),
        valueCents: 150_000,
      },
    ]);
    const { getReportsMetrics } = await import("./queries");

    const metrics = await getReportsMetrics("user_owner", now);

    const august = metrics.revenueTrend.find((point) => point.month === "2026-08");
    const july = metrics.revenueTrend.find((point) => point.month === "2026-07");
    expect(august?.valueCents).toBe(150_000);
    expect(july?.valueCents).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `bun test "apps/app/app/(authenticated)/reports/queries.test.ts"`  
Expected: FAIL because `./queries` does not exist.

- [ ] **Step 3: Implement `queries.ts`**

```ts
import { database, type PipelineStage } from "@repo/database";

import { getTrailingMonths, type MonthBucket, sumByMonth } from "../../lib/reports/months";

const ACTIVE_FUNNEL_STAGES: PipelineStage[] = [
  "NEW",
  "CONTACTED",
  "INTERESTED",
  "PROPOSAL",
];
const TREND_MONTH_COUNT = 12;

export interface FunnelStageCount {
  count: number;
  stage: PipelineStage;
}

export interface StageConversion {
  from: PipelineStage;
  rate: number | null;
  to: PipelineStage;
}

export interface MonthlyPoint {
  label: string;
  month: string;
}

export interface RevenuePoint extends MonthlyPoint {
  valueCents: number;
}

export interface TaskTrendPoint extends MonthlyPoint {
  completed: number;
  created: number;
}

export interface ActivityTrendPoint extends MonthlyPoint {
  audits: number;
  outreachDrafts: number;
}

export interface ReportsMetrics {
  activityTrend: ActivityTrendPoint[];
  conversionRates: StageConversion[];
  funnel: FunnelStageCount[];
  revenueTrend: RevenuePoint[];
  taskTrend: TaskTrendPoint[];
  terminalTotals: { lost: number; won: number };
  winRate: number | null;
}

const countReached = async (userId: string, stage: PipelineStage) => {
  const rows = await database.pipelineStageChange.findMany({
    where: { userId, toStage: stage },
    select: { prospectId: true },
    distinct: ["prospectId"],
  });
  return rows.length;
};

const getMostRecentLostDates = async (userId: string) => {
  const rows = await database.pipelineStageChange.findMany({
    where: { userId, toStage: "LOST", prospect: { pipelineStage: "LOST" } },
    orderBy: { changedAt: "desc" },
    distinct: ["prospectId"],
    select: { changedAt: true },
  });
  return rows.map((row) => row.changedAt);
};

const toMonthlyPoints = (months: MonthBucket[]): MonthlyPoint[] =>
  months.map((month) => ({ month: month.key, label: month.label }));

export const getReportsMetrics = async (
  userId: string,
  now = new Date()
): Promise<ReportsMetrics> => {
  const months = getTrailingMonths(now, TREND_MONTH_COUNT);
  const windowStart = months[0].start;

  const [
    funnelCounts,
    reachedCounts,
    wonDeals,
    wonCountInWindow,
    lostDates,
    createdTasks,
    completedTasks,
    audits,
    outreachDrafts,
    wonTotal,
    lostTotal,
  ] = await Promise.all([
    Promise.all(
      ACTIVE_FUNNEL_STAGES.map((stage) =>
        database.prospect.count({
          where: { userId, archivedAt: null, pipelineStage: stage },
        })
      )
    ),
    Promise.all(ACTIVE_FUNNEL_STAGES.map((stage) => countReached(userId, stage))),
    database.deal.findMany({
      where: {
        userId,
        prospect: { pipelineStage: "WON" },
        actualCloseDate: { gte: windowStart, lte: now },
      },
      select: { actualCloseDate: true, valueCents: true },
    }),
    database.deal.count({
      where: {
        userId,
        prospect: { pipelineStage: "WON" },
        actualCloseDate: { gte: windowStart, lte: now },
      },
    }),
    getMostRecentLostDates(userId),
    database.task.findMany({
      where: { userId, createdAt: { gte: windowStart, lte: now } },
      select: { createdAt: true },
    }),
    database.task.findMany({
      where: {
        userId,
        status: "COMPLETED",
        completedAt: { gte: windowStart, lte: now },
      },
      select: { completedAt: true },
    }),
    database.websiteAudit.findMany({
      where: { userId, createdAt: { gte: windowStart, lte: now } },
      select: { createdAt: true },
    }),
    database.outreachDraft.findMany({
      where: { userId, createdAt: { gte: windowStart, lte: now } },
      select: { createdAt: true },
    }),
    database.prospect.count({ where: { userId, pipelineStage: "WON" } }),
    database.prospect.count({ where: { userId, pipelineStage: "LOST" } }),
  ]);

  const funnel = ACTIVE_FUNNEL_STAGES.map((stage, index) => ({
    stage,
    count: funnelCounts[index],
  }));

  const conversionRates: StageConversion[] = ACTIVE_FUNNEL_STAGES.slice(
    0,
    -1
  ).map((stage, index) => {
    const reachedFrom = reachedCounts[index];
    const reachedTo = reachedCounts[index + 1];
    return {
      from: stage,
      to: ACTIVE_FUNNEL_STAGES[index + 1],
      rate: reachedFrom === 0 ? null : reachedTo / reachedFrom,
    };
  });

  const lostCountInWindow = lostDates.filter(
    (date) => date >= windowStart && date <= now
  ).length;
  const closedInWindow = wonCountInWindow + lostCountInWindow;
  const winRate = closedInWindow === 0 ? null : wonCountInWindow / closedInWindow;

  const monthlyPoints = toMonthlyPoints(months);
  const revenueValues = sumByMonth(
    months,
    wonDeals,
    (deal) => deal.actualCloseDate as Date,
    (deal) => deal.valueCents ?? 0
  );
  const createdCounts = sumByMonth(months, createdTasks, (task) => task.createdAt);
  const completedCounts = sumByMonth(
    months,
    completedTasks,
    (task) => task.completedAt as Date
  );
  const auditCounts = sumByMonth(months, audits, (audit) => audit.createdAt);
  const outreachCounts = sumByMonth(
    months,
    outreachDrafts,
    (draft) => draft.createdAt
  );

  return {
    funnel,
    terminalTotals: { won: wonTotal, lost: lostTotal },
    conversionRates,
    winRate,
    revenueTrend: monthlyPoints.map((point, index) => ({
      ...point,
      valueCents: revenueValues[index],
    })),
    taskTrend: monthlyPoints.map((point, index) => ({
      ...point,
      created: createdCounts[index],
      completed: completedCounts[index],
    })),
    activityTrend: monthlyPoints.map((point, index) => ({
      ...point,
      audits: auditCounts[index],
      outreachDrafts: outreachCounts[index],
    })),
  };
};
```

- [ ] **Step 4: Run tests and verify GREEN**

Run: `bun test "apps/app/app/(authenticated)/reports/queries.test.ts"`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/app/app/(authenticated)/reports"
git commit -m "feat: add reports metrics queries"
```

---

### Task 5: Reports page and charts

**Files:**
- Create: `apps/app/app/(authenticated)/reports/empty-state.tsx`
- Create: `apps/app/app/(authenticated)/reports/trend-chart.tsx`
- Create: `apps/app/app/(authenticated)/reports/trend-chart.test.ts`
- Create: `apps/app/app/(authenticated)/reports/funnel-chart.tsx`
- Create: `apps/app/app/(authenticated)/reports/funnel-chart.test.ts`
- Create: `apps/app/app/(authenticated)/reports/page.tsx`
- Modify: `apps/app/app/(authenticated)/layout.tsx`
- Modify: `apps/app/app/(authenticated)/page.tsx`

**Interfaces:**
- Consumes: `getReportsMetrics` and all types from `./queries` (Task 4).
- Produces: `hasTrendData`, `TrendChart`, `hasFunnelData`, `FunnelChart`, `ReportsEmptyState` — no other task depends on these.

- [ ] **Step 1: Write failing tests for the empty-data predicates**

`trend-chart.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hasTrendData } from "./trend-chart";

describe("hasTrendData", () => {
  it("is false when every series value is zero across all points", () => {
    expect(
      hasTrendData(
        [{ label: "Jul 2026", month: "2026-07", created: 0, completed: 0 }],
        ["created", "completed"]
      )
    ).toBe(false);
  });

  it("is true when any series value is non-zero", () => {
    expect(
      hasTrendData(
        [{ label: "Jul 2026", month: "2026-07", created: 2, completed: 0 }],
        ["created", "completed"]
      )
    ).toBe(true);
  });
});
```

`funnel-chart.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hasFunnelData } from "./funnel-chart";

describe("hasFunnelData", () => {
  it("is false with an empty funnel and zero terminal totals", () => {
    expect(
      hasFunnelData([{ stage: "NEW", count: 0 }], { won: 0, lost: 0 })
    ).toBe(false);
  });

  it("is true when any funnel stage or terminal total is non-zero", () => {
    expect(
      hasFunnelData([{ stage: "NEW", count: 0 }], { won: 1, lost: 0 })
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `bun test "apps/app/app/(authenticated)/reports/trend-chart.test.ts" "apps/app/app/(authenticated)/reports/funnel-chart.test.ts"`  
Expected: FAIL because the source files do not exist.

- [ ] **Step 3: Implement the empty state**

`empty-state.tsx`:

```tsx
export const ReportsEmptyState = ({ message }: { message: string }) => (
  <div className="flex h-48 items-center justify-center text-center text-muted-foreground text-sm">
    {message}
  </div>
);
```

- [ ] **Step 4: Implement the generic trend chart**

`trend-chart.tsx`:

```tsx
"use client";

import {
  ChartContainer,
  type ChartConfig,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@repo/design-system/components/ui/chart";
import { CartesianGrid, Line, LineChart, XAxis } from "recharts";

import { ReportsEmptyState } from "./empty-state";

export interface TrendSeries {
  color: string;
  dataKey: string;
  label: string;
}

export const hasTrendData = <T extends Record<string, unknown>>(
  data: T[],
  dataKeys: string[]
): boolean =>
  data.some((point) => dataKeys.some((key) => Number(point[key]) > 0));

export const TrendChart = <T extends Record<string, unknown>>({
  data,
  emptyMessage,
  series,
}: {
  data: T[];
  emptyMessage: string;
  series: TrendSeries[];
}) => {
  if (!hasTrendData(data, series.map((line) => line.dataKey))) {
    return <ReportsEmptyState message={emptyMessage} />;
  }

  const config: ChartConfig = Object.fromEntries(
    series.map((line) => [
      line.dataKey,
      { label: line.label, color: line.color },
    ])
  );

  return (
    <ChartContainer className="h-64 w-full" config={config}>
      <LineChart data={data}>
        <CartesianGrid vertical={false} />
        <XAxis
          axisLine={false}
          dataKey="label"
          tickLine={false}
          tickMargin={8}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        {series.map((line) => (
          <Line
            dataKey={line.dataKey}
            dot={false}
            key={line.dataKey}
            stroke={`var(--color-${line.dataKey})`}
            type="monotone"
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
};
```

- [ ] **Step 5: Implement the funnel chart**

`funnel-chart.tsx`:

```tsx
"use client";

import {
  ChartContainer,
  type ChartConfig,
  ChartTooltip,
  ChartTooltipContent,
} from "@repo/design-system/components/ui/chart";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";

import type { FunnelStageCount, StageConversion } from "./queries";
import { ReportsEmptyState } from "./empty-state";

const STAGE_LABELS: Record<string, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  INTERESTED: "Interested",
  PROPOSAL: "Proposal",
};

const CHART_CONFIG: ChartConfig = {
  count: { label: "Active prospects", color: "var(--chart-1)" },
};

export const hasFunnelData = (
  funnel: FunnelStageCount[],
  terminalTotals: { lost: number; won: number }
): boolean =>
  funnel.some((stage) => stage.count > 0) ||
  terminalTotals.won > 0 ||
  terminalTotals.lost > 0;

export const FunnelChart = ({
  conversionRates,
  funnel,
  terminalTotals,
}: {
  conversionRates: StageConversion[];
  funnel: FunnelStageCount[];
  terminalTotals: { lost: number; won: number };
}) => {
  if (!hasFunnelData(funnel, terminalTotals)) {
    return (
      <ReportsEmptyState message="No prospects yet — the funnel fills in once you add some." />
    );
  }

  const data = funnel.map((stage) => ({
    label: STAGE_LABELS[stage.stage],
    count: stage.count,
  }));

  return (
    <div className="space-y-4">
      <ChartContainer className="h-64 w-full" config={CHART_CONFIG}>
        <BarChart data={data}>
          <CartesianGrid vertical={false} />
          <XAxis
            axisLine={false}
            dataKey="label"
            tickLine={false}
            tickMargin={8}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="count" fill="var(--color-count)" radius={4} />
        </BarChart>
      </ChartContainer>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {conversionRates.map((conversion) => (
          <div
            className="rounded-lg border p-3"
            key={`${conversion.from}-${conversion.to}`}
          >
            <dt className="text-muted-foreground text-xs">
              {STAGE_LABELS[conversion.from]} → {STAGE_LABELS[conversion.to]}
            </dt>
            <dd className="font-mono font-semibold text-lg tabular-nums">
              {conversion.rate === null
                ? "—"
                : `${Math.round(conversion.rate * 100)}%`}
            </dd>
          </div>
        ))}
        <div className="rounded-lg border p-3">
          <dt className="text-muted-foreground text-xs">Won</dt>
          <dd className="font-mono font-semibold text-lg tabular-nums">
            {terminalTotals.won}
          </dd>
        </div>
        <div className="rounded-lg border p-3">
          <dt className="text-muted-foreground text-xs">Lost</dt>
          <dd className="font-mono font-semibold text-lg tabular-nums">
            {terminalTotals.lost}
          </dd>
        </div>
      </dl>
    </div>
  );
};
```

- [ ] **Step 6: Run tests and verify GREEN**

Run: `bun test "apps/app/app/(authenticated)/reports/trend-chart.test.ts" "apps/app/app/(authenticated)/reports/funnel-chart.test.ts"`  
Expected: PASS.

- [ ] **Step 7: Build the page**

`page.tsx`:

```tsx
import { ensureCurrentUser } from "@repo/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/ui/card";

import { FunnelChart } from "./funnel-chart";
import { getReportsMetrics } from "./queries";
import { TrendChart } from "./trend-chart";

const ReportsPage = async () => {
  const user = await ensureCurrentUser();
  const metrics = await getReportsMetrics(user.id);

  return (
    <div className="space-y-6">
      <div className="border-b pb-5">
        <p className="font-medium text-emerald-700 text-xs uppercase tracking-[0.22em] dark:text-emerald-400">
          Reporting
        </p>
        <h1 className="mt-1 font-semibold text-3xl tracking-tight">
          Reports
        </h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Pipeline flow, revenue, and activity over the trailing 12 months.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pipeline</CardTitle>
          <CardDescription>
            Active prospects by stage and stage-to-stage conversion.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FunnelChart
            conversionRates={metrics.conversionRates}
            funnel={metrics.funnel}
            terminalTotals={metrics.terminalTotals}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Revenue</CardTitle>
          <CardDescription>
            Win rate and won revenue over the trailing 12 months.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="font-mono font-semibold text-3xl tabular-nums">
            {metrics.winRate === null
              ? "—"
              : `${Math.round(metrics.winRate * 100)}%`}
          </p>
          <TrendChart
            data={metrics.revenueTrend.map((point) => ({
              ...point,
              valueCents: point.valueCents / 100,
            }))}
            emptyMessage="No closed deals yet in the last 12 months."
            series={[
              {
                color: "var(--chart-1)",
                dataKey: "valueCents",
                label: "Won revenue",
              },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
          <CardDescription>
            Follow-through over the trailing 12 months.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <TrendChart
            data={metrics.taskTrend}
            emptyMessage="No tasks yet in the last 12 months."
            series={[
              { color: "var(--chart-1)", dataKey: "created", label: "Created" },
              {
                color: "var(--chart-2)",
                dataKey: "completed",
                label: "Completed",
              },
            ]}
          />
          <TrendChart
            data={metrics.activityTrend}
            emptyMessage="No audits or outreach drafts yet in the last 12 months."
            series={[
              { color: "var(--chart-1)", dataKey: "audits", label: "Audits" },
              {
                color: "var(--chart-2)",
                dataKey: "outreachDrafts",
                label: "Outreach drafts",
              },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
};

export default ReportsPage;
```

- [ ] **Step 8: Add navigation and the Dashboard link**

In `apps/app/app/(authenticated)/layout.tsx`, add `<Link href="/reports">Reports</Link>` after `<Link href="/outreach">Outreach</Link>` and before `<Link href="/settings">Settings</Link>`.

In `apps/app/app/(authenticated)/page.tsx`, add a fifth entry to the `cards` array (after the "Open Deal value" entry), using the `LineChart` icon already available from `lucide-react`:

```ts
{
  description: "Pipeline, revenue, and activity trends",
  href: "/reports",
  icon: LineChart,
  label: "Reports",
  tone: "text-violet-600",
  value: "View",
},
```

Add `LineChart` to the existing `lucide-react` import at the top of the file.

- [ ] **Step 9: Run formatter and full verification**

Run:

```bash
bun run fix
bun --filter app typecheck
bun test "apps/app/app/(authenticated)/reports"
```

Expected: PASS and no formatter changes remaining.

- [ ] **Step 10: Commit**

```bash
git add "apps/app/app/(authenticated)/reports" "apps/app/app/(authenticated)/layout.tsx" "apps/app/app/(authenticated)/page.tsx"
git commit -m "feat: add reports dashboard workspace"
```

---

### Task 6: Documentation, migration deployment, and acceptance verification

**Files:**
- Create: `docs/architecture/0007-m6-dashboard-metrics.md`
- Modify: `README.md`

**Interfaces:**
- Documents: the stage-history log, its no-retroactive-history limitation, conversion/win-rate methodology, the `/reports` route, and non-goals.

- [ ] **Step 1: Add ADR and README documentation**

In `docs/architecture/0007-m6-dashboard-metrics.md`, document: why a `PipelineStageChange` log was added instead of inferring history from the current snapshot (M5 allows non-linear stage moves, so a snapshot cannot reconstruct history); why it is additive-only with no backfill for existing prospects; the exact conversion-rate and win-rate formulas from this plan's Global Constraints; why aggregation is on-demand with no caching layer or scheduler; and the full M6 (dashboard-metrics half) non-goals list from the spec.

In `README.md`, add `/reports` to the authenticated application routes list, positioned after `/outreach/[id]` and before `/settings`:

```markdown
- `/reports` — pipeline funnel/conversion, win rate, revenue, and activity trends over the trailing 12 months
```

- [ ] **Step 2: Apply migration to configured test database**

Run: `bun run migrate:deploy` with the configured database environment sourced without printing values.  
Expected: `20260805050000_m6_pipeline_stage_history` applies successfully.

- [ ] **Step 3: Run fresh full verification**

Run:

```bash
bun run check
bun run test
bun run build
cd packages/database && bunx prisma validate
cd ../.. && git diff --check
```

Expected: all commands exit 0; build lists `/reports`.

- [ ] **Step 4: Run local authenticated browser acceptance**

Using an allowlisted owner session:

1. Load `/reports` as an owner with no prospects/deals/tasks and confirm every section shows its empty state, not a broken or empty chart.
2. Create a prospect, move it through New → Contacted → Interested → Proposal → Won with a value and close date; reload `/reports` and confirm the funnel, conversion rates, win rate, and revenue trend all update.
3. Move a second prospect to Lost with a reason; reload `/reports` and confirm win rate reflects both outcomes.
4. Move a prospect backward (e.g., Proposal → Contacted) and confirm conversion rates still compute without error.
5. Complete a task and run an audit or generate an outreach draft; reload `/reports` and confirm the activity trend updates.
6. Verify browser console contains no application errors.

No external accounts or side effects are required for this milestone.

- [ ] **Step 5: Commit docs and inspect branch**

```bash
git add README.md docs/architecture/0007-m6-dashboard-metrics.md
git commit -m "docs: record M6 dashboard metrics decisions"
git status --short
git log --oneline main..HEAD
git diff --stat main...HEAD
```

Expected: clean tree and only M6 design, persistence, queries, UI, tests, and documentation.

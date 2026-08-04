# M5 Pipeline, Tasks, and Deals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fixed owner-scoped sales pipeline, one optional deal per prospect, manual prospect tasks, and operational dashboard counts.

**Architecture:** Separate archive state from pipeline progress on `Prospect`, store one optional `Deal` and many `Task` records, and keep every read/mutation inside `apps/app` using Clerk-derived owner scoping. Use explicit server-authorized actions and accessible controls; no drag-and-drop, automation service, scheduler, or second deployment.

**Tech Stack:** Next.js 16 App Router, React 19 Server Components/server actions, Clerk, Prisma 7 with `@prisma/adapter-pg`, PostgreSQL, Zod 4, Vitest 4, Bun, Biome/Ultracite

## Global Constraints

- Pipeline stages are exactly `NEW | CONTACTED | INTERESTED | PROPOSAL | WON | LOST`.
- Archive state is `archivedAt: DateTime?`, independent from `pipelineStage`.
- Migrate existing `NEW` to `NEW`, `QUALIFIED` to `INTERESTED`, and `ARCHIVED` to `NEW` plus a migration timestamp.
- One optional Deal exists per prospect; money is stored as positive integer `valueCents`.
- Deal editing is available at Interested or later; Won requires positive value and actual close date; Lost requires a trimmed loss reason.
- Moving away from Won clears `actualCloseDate`; moving away from Lost clears `lossReason`.
- Tasks are manual, prospect-linked, and use exact priorities `LOW | MEDIUM | HIGH` and statuses `OPEN | COMPLETED`.
- M5 uses fixed product timezone `America/New_York`; calculations must not depend on deployment timezone or machine clock.
- Derive owner ID exclusively from `auth()` and enforce the Clerk allowlist for every mutation.
- Every query and mutation includes owner scope; ignore browser-submitted owner, linkage, current-state, status, and completion timestamp values.
- Stage plus Deal transitions are atomic; archived prospects cannot transition.
- Logs exclude task titles, loss reasons, deal values, notes, contact details, submitted form data, and raw errors.
- Stage/deal/outreach actions never create, edit, or complete tasks automatically.
- Do not add drag-and-drop, automatic tasks, sending/tracking, multiple deals, custom stages, permanent deletion, reminders, notifications, calendar sync, charts, QStash, webhooks, or another service.

---

### Task 1: Lifecycle, Deal, Task persistence and validation

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260805030000_m5_pipeline_tasks_deals/migration.sql`
- Create: `packages/validation/pipeline.ts`
- Create: `packages/validation/pipeline.test.ts`
- Create: `packages/validation/tasks.ts`
- Create: `packages/validation/tasks.test.ts`
- Modify: `packages/validation/index.ts`

**Interfaces:**
- Produces: Prisma `PipelineStage`, `Deal`, `Task`, `TaskPriority`, and `TaskStatus`.
- Produces: `pipelineTransitionSchema`, `dealEditSchema`, `taskInputSchema`, and exact inferred types from `@repo/validation`.

- [ ] **Step 1: Write failing validation tests**

Test accepted normalized values and rejection behavior owned by LeadForge:

```ts
expect(pipelineTransitionSchema.parse({
  destination: "WON",
  value: "1250.50",
  actualCloseDate: "2026-08-04",
  lossReason: "",
})).toEqual({
  destination: "WON",
  valueCents: 125050,
  actualCloseDate: new Date("2026-08-04T12:00:00.000Z"),
  lossReason: null,
});
```

Also prove invalid stage, zero/negative/over-`2_147_483_647` cents, more than two currency decimals, missing Won fields, missing/over-500-character Lost reason, malformed dates, blank/over-160-character task titles, invalid priority, and malformed due date fail safely.

- [ ] **Step 2: Run validation tests and verify RED**

Run: `bun test packages/validation/pipeline.test.ts packages/validation/tasks.test.ts`  
Expected: FAIL because the modules/exports do not exist.

- [ ] **Step 3: Implement schemas**

Use separate schemas for:

```ts
pipelineTransitionSchema // discriminated by destination; Won/Lost requirements enforced
dealEditSchema           // value and expected close date, both nullable
taskInputSchema          // title, dueAt, priority
```

Convert currency strings to integer cents without floating-point rounding: validate `/^\d+(\.\d{1,2})?$/`, split dollars/cents, and combine as integers. Parse date-only deal fields at noon UTC to avoid client/server date shifts. Parse task `dueAt` as an ISO datetime with offset and store a `Date`.

- [ ] **Step 4: Add Prisma models and migration**

Update `Prospect` with `pipelineStage @default(NEW)`, `archivedAt`, optional `deal`, and `tasks`. Remove `ProspectStatus` and `status` only after migration SQL adds/backfills replacements. Add:

```prisma
model Deal {
  id                String    @id @default(cuid())
  userId            String
  prospectId        String    @unique
  valueCents        Int?
  expectedCloseDate DateTime?
  actualCloseDate   DateTime?
  lossReason        String?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  prospect          Prospect  @relation(fields: [prospectId], references: [id], onDelete: Cascade)
  @@index([userId, expectedCloseDate])
}
```

Add `Task` with owner/prospect/title/dueAt/priority/status/completedAt/timestamps, cascade from prospect, and indexes `[userId, status, dueAt]`, `[userId, prospectId, status, dueAt]`, and `[userId, priority, status]`. Replace the former prospect status index with `[userId, archivedAt]` and add `[userId, pipelineStage]`.

Migration SQL must explicitly drop the old `[userId,status]` index, add/backfill non-null pipeline stage, backfill `archivedAt` for archived rows, remove old status/type, create new enums/tables/constraints/indexes, and use one captured `CURRENT_TIMESTAMP` statement for archived rows.

- [ ] **Step 5: Generate and validate**

Run:

```bash
bunx prisma format --schema packages/database/prisma/schema.prisma
cd packages/database && bunx prisma generate && bunx prisma validate
bun test packages/validation/pipeline.test.ts packages/validation/tasks.test.ts
```

Expected: schema valid and focused tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/database/prisma packages/validation
git commit -m "feat: add pipeline deal and task persistence"
```

---

### Task 2: Migrate prospect archive/list behavior

**Files:**
- Modify: `apps/app/app/actions/prospects.ts`
- Modify: `apps/app/app/actions/prospects.test.ts`
- Modify: `apps/app/app/(authenticated)/prospects/queries.ts`
- Modify: `apps/app/app/(authenticated)/prospects/queries.test.ts`
- Modify: `apps/app/app/(authenticated)/prospects/list-controls.tsx`
- Modify: `apps/app/app/(authenticated)/prospects/page.tsx`
- Modify: `apps/app/app/(authenticated)/prospects/[id]/page.tsx`

**Interfaces:**
- Preserves: existing create/update/archive/restore action names and form contracts.
- Changes: prospect list filter to `ACTIVE | ARCHIVED` plus separate `stage?: PipelineStage`.
- Changes: archive writes `archivedAt: new Date()` and restore writes `archivedAt: null` without changing `pipelineStage`.

- [ ] **Step 1: Update failing query/action tests first**

Assert:

```ts
// Active
where: { userId: "user_owner", archivedAt: null }
// Archived
where: { userId: "user_owner", archivedAt: { not: null } }
// Active + stage
where: { userId: "user_owner", archivedAt: null, pipelineStage: "PROPOSAL" }
```

Archive/restore tests must verify owner-scoped `updateMany`, exact `archivedAt` semantics, and preservation of pipelineStage. Logger assertions must verify no raw error objects.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
bun test apps/app/app/actions/prospects.test.ts 'apps/app/app/(authenticated)/prospects/queries.test.ts'
```

Expected: FAIL against old `status` behavior.

- [ ] **Step 3: Implement lifecycle migration in code**

Rename the status mutation helper to archive-state semantics. Use a single `now` per archive action, `archivedAt: now`/`null`, sanitized log metadata, and revalidate `/prospects`, `/pipeline`, and detail.

Normalize prospect query inputs so `status` accepts only `ACTIVE | ARCHIVED`; normalize `stage` only to the six enum values. Update controls/table/detail badges to show archive state separately from a humanized pipeline stage.

- [ ] **Step 4: Verify and commit**

Run:

```bash
bun test apps/app/app/actions/prospects.test.ts 'apps/app/app/(authenticated)/prospects/queries.test.ts'
bun --filter app typecheck
```

Expected: PASS.

```bash
git add apps/app/app/actions/prospects* 'apps/app/app/(authenticated)/prospects'
git commit -m "feat: separate prospect archive and pipeline state"
```

---

### Task 3: Time boundaries and task mutations

**Files:**
- Create: `apps/app/app/lib/tasks/time.ts`
- Create: `apps/app/app/lib/tasks/time.test.ts`
- Create: `apps/app/app/actions/tasks.ts`
- Create: `apps/app/app/actions/tasks.test.ts`

**Interfaces:**
- Produces: `APP_TIME_ZONE = "America/New_York"`.
- Produces: `getTaskDayBounds(now: Date): { start: Date; end: Date }`.
- Produces: `zonedLocalInputToIso(value: string): string` and `dateToZonedLocalInput(value: Date): string` for `datetime-local` controls.
- Produces: `createTask`, `updateTask`, `completeTask`, and `reopenTask` server actions.

- [ ] **Step 1: Write failing timezone tests**

Assert exact UTC boundaries:

```ts
expect(getTaskDayBounds(new Date("2026-01-15T15:00:00Z"))).toEqual({
  start: new Date("2026-01-15T05:00:00Z"),
  end: new Date("2026-01-16T05:00:00Z"),
});
expect(getTaskDayBounds(new Date("2026-07-15T15:00:00Z"))).toEqual({
  start: new Date("2026-07-15T04:00:00Z"),
  end: new Date("2026-07-16T04:00:00Z"),
});
```

Cover spring-forward and fall-back dates. Implement with `Intl.DateTimeFormat(..., { timeZone: APP_TIME_ZONE })` plus an offset-resolution helper; do not use process timezone.
Test local-input conversion in winter/summer and reject nonexistent spring-forward wall times rather than silently shifting them. Test Date-to-input formatting in the fixed timezone.

- [ ] **Step 2: Run timezone tests RED then GREEN**

Run: `bun test apps/app/app/lib/tasks/time.test.ts`  
Expected first: missing module; after minimal implementation: PASS.

- [ ] **Step 3: Write failing task action tests**

Prove:

- unauthorized exits before database access
- create reloads owned active prospect and ignores forged owner/prospect replacement fields
- edit updates only `{ title, dueAt, priority }` using `{ id, userId }`
- Complete uses owner-scoped `updateMany` with `{ status: "OPEN" }` and server `completedAt`
- Reopen uses `{ status: "COMPLETED" }`, sets OPEN, clears completedAt
- missing/cross-owner rows return one safe message
- database errors log only IDs/action/safe code, never title/form/raw error

- [ ] **Step 4: Run action tests and verify RED**

Run: `bun test apps/app/app/actions/tasks.test.ts`  
Expected: FAIL because task actions do not exist.

- [ ] **Step 5: Implement task actions**

Parse only trusted editable fields. Creation accepts an opaque `prospectId` parameter and reloads `{ id, userId, archivedAt: null }`. Editing never accepts prospect replacement. Complete/Reopen accept only task ID. Revalidate `/tasks`, `/prospects/<prospectId>`, and `/` after success.

- [ ] **Step 6: Verify and commit**

Run:

```bash
bun test apps/app/app/lib/tasks/time.test.ts apps/app/app/actions/tasks.test.ts
bun --filter app typecheck
```

Expected: PASS.

```bash
git add apps/app/app/lib/tasks apps/app/app/actions/tasks*
git commit -m "feat: add owner-scoped task lifecycle"
```

---

### Task 4: Task and dashboard queries

**Files:**
- Create: `apps/app/app/(authenticated)/tasks/queries.ts`
- Create: `apps/app/app/(authenticated)/tasks/queries.test.ts`
- Create: `apps/app/app/(authenticated)/dashboard/queries.ts`
- Create: `apps/app/app/(authenticated)/dashboard/queries.test.ts`

**Interfaces:**
- Produces: `parseTaskListParams`, `getTasks`, and `getProspectTasks`.
- Produces: `getDashboardMetrics(userId, now?)`.
- Consumes: `getTaskDayBounds` and `APP_TIME_ZONE`.

- [ ] **Step 1: Write failing task query tests**

Define filters `OPEN | DUE_TODAY | OVERDUE | COMPLETED` and priority `ALL | LOW | MEDIUM | HIGH`. Default to OPEN, page 1, all priorities, 25 items.

Assert exact owner-scoped predicates:

```ts
DUE_TODAY: { userId, status: "OPEN", dueAt: { gte: start, lt: end } }
OVERDUE: { userId, status: "OPEN", dueAt: { lt: now } }
COMPLETED: { userId, status: "COMPLETED" }
```

Declare the PostgreSQL/Prisma priority enum in business sort order `HIGH | MEDIUM | LOW`. Open ordering uses `dueAt asc`, `priority asc`, `createdAt asc`, `id asc`, so priority tie-breaking remains correct across pagination boundaries. Tests cover equal due instants. Completed ordering is `completedAt desc`, then id.

- [ ] **Step 2: Run task query tests and verify RED**

Run: `bun test 'apps/app/app/(authenticated)/tasks/queries.test.ts'`  
Expected: FAIL because queries do not exist.

- [ ] **Step 3: Implement task queries**

Batch prospect names with one owner-scoped query. `getProspectTasks` uses `{ userId, prospectId }`, returns open and completed arrays, and never falls back unscoped.

- [ ] **Step 4: Write failing dashboard tests**

Mock one injected `now`, calculate bounds once, and assert four owner-scoped aggregates:

- overdue open task count (`dueAt < now`)
- due-today open task count (`start <= dueAt < end`)
- active prospect count (`archivedAt = null`)
- Deal `valueCents` sum where owner matches, value non-null, and related prospect is active with stage in Interested/Proposal

- [ ] **Step 5: Implement dashboard aggregates and verify**

Run:

```bash
bun test 'apps/app/app/(authenticated)/tasks/queries.test.ts' 'apps/app/app/(authenticated)/dashboard/queries.test.ts'
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add 'apps/app/app/(authenticated)/tasks' 'apps/app/app/(authenticated)/dashboard'
git commit -m "feat: add task and dashboard read models"
```

---

### Task 5: Pipeline and Deal actions/queries

**Files:**
- Create: `apps/app/app/actions/pipeline.ts`
- Create: `apps/app/app/actions/pipeline.test.ts`
- Create: `apps/app/app/(authenticated)/pipeline/queries.ts`
- Create: `apps/app/app/(authenticated)/pipeline/queries.test.ts`

**Interfaces:**
- Produces: `moveProspectStage(previousState, formData)` and `saveDeal(previousState, formData)`.
- Produces: `getPipeline(userId)` and `getProspectPipelineDetail(userId, prospectId)`.

- [ ] **Step 1: Write failing transition tests**

Prove `moveProspectStage`:

- authorizes before parsing/database
- accepts only prospect ID, destination, and destination closing fields
- reloads owned, non-archived prospect and owner-scoped Deal
- rejects malformed destination and missing Won/Lost requirements
- uses one transaction to update stage and upsert/update Deal
- clears `actualCloseDate` away from Won and `lossReason` away from Lost
- never touches Task
- ignores forged owner/current-stage/deal/task IDs
- logs only safe metadata, never closing inputs/raw error

- [ ] **Step 2: Write failing Deal edit tests**

Prove `saveDeal` works only for owned active prospects in Interested/Proposal/Won/Lost, parses optional value/expected date, upserts by prospect, preserves terminal-only fields unless the action explicitly edits them, and returns safe errors.

- [ ] **Step 3: Run action tests and verify RED**

Run: `bun test apps/app/app/actions/pipeline.test.ts`  
Expected: FAIL because pipeline actions do not exist.

- [ ] **Step 4: Implement atomic actions**

Use an interactive Prisma transaction so the prospect reload, Deal reload/upsert, closing validation, and stage write share one consistent boundary. Use owner predicates on all reads/writes and require affected-row counts. Revalidate `/pipeline`, `/prospects/<id>`, `/prospects`, and `/`.

- [ ] **Step 5: Write failing pipeline query tests**

Assert `getPipeline` reads only `{ userId, archivedAt: null }`, batches Deals and open Tasks with owner scope, groups all six stages even when empty, and card projections contain only required fields. Test deterministic nearest-task/update/id ordering.

`getProspectPipelineDetail` returns one owned prospect plus owner-scoped Deal or null.

- [ ] **Step 6: Implement queries and verify**

Run:

```bash
bun test apps/app/app/actions/pipeline.test.ts 'apps/app/app/(authenticated)/pipeline/queries.test.ts'
bun --filter app typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/app/app/actions/pipeline* 'apps/app/app/(authenticated)/pipeline/queries.ts' 'apps/app/app/(authenticated)/pipeline/queries.test.ts'
git commit -m "feat: add owner-scoped pipeline workflow"
```

---

### Task 6: Pipeline board UI

**Files:**
- Create: `apps/app/app/(authenticated)/pipeline/page.tsx`
- Create: `apps/app/app/(authenticated)/pipeline/move-stage-form.tsx`
- Create: `apps/app/app/(authenticated)/pipeline/move-stage-form.test.tsx`
- Create: `apps/app/app/(authenticated)/pipeline/pipeline-card.tsx`
- Modify: `apps/app/app/(authenticated)/layout.tsx`

**Interfaces:**
- Consumes: `getPipeline` and `moveProspectStage`.
- Produces: `/pipeline` board and navigation link.

- [ ] **Step 1: Build the board from server data**

Render six fixed columns with counts, horizontally scrollable on narrow screens. Cards show business/contact/hostname, open-task count, nearest due date, and formatted Deal value. Use `Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })` on cents/100. Link each card to prospect detail.

- [ ] **Step 2: Build explicit stage controls**

Use `useActionState` with a destination select. Reveal positive currency + actual-close date inputs only for Won; reveal loss-reason textarea only for Lost. Ensure labels, error/status live regions, pending state, and server refresh after success. Do not render drag handles or optimistic movement.

- [ ] **Step 3: Add focused component tests**

Using the app Vitest/jsdom configuration, verify destination selection reveals exact closing fields, pending/validation feedback is accessible, and ordinary stage selection sends only the named form fields. Do not test the design-system Select/Button internals.

- [ ] **Step 4: Verify and commit**

Run:

```bash
bun test 'apps/app/app/(authenticated)/pipeline/move-stage-form.test.tsx'
bun --filter app typecheck
```

Expected: PASS.

```bash
git add 'apps/app/app/(authenticated)/pipeline' 'apps/app/app/(authenticated)/layout.tsx'
git commit -m "feat: add sales pipeline board"
```

---

### Task 7: Tasks, prospect workflow, and dashboard UI

**Files:**
- Create: `apps/app/app/(authenticated)/tasks/page.tsx`
- Create: `apps/app/app/(authenticated)/tasks/task-controls.tsx`
- Create: `apps/app/app/(authenticated)/tasks/task-status-button.tsx`
- Create: `apps/app/app/(authenticated)/prospects/[id]/pipeline-deal-form.tsx`
- Create: `apps/app/app/(authenticated)/prospects/[id]/task-form.tsx`
- Create: `apps/app/app/(authenticated)/prospects/[id]/task-list.tsx`
- Modify: `apps/app/app/(authenticated)/prospects/[id]/page.tsx`
- Modify: `apps/app/app/(authenticated)/page.tsx`
- Modify: `apps/app/app/(authenticated)/layout.tsx`

**Interfaces:**
- Consumes: task/pipeline actions and all Task 4–5 queries.
- Produces: `/tasks`, prospect pipeline/deal/task hub, and linked dashboard metrics.

- [ ] **Step 1: Build global Tasks page**

Render normalized status/priority filters, owner-scoped paginated results, deterministic due/priority/status presentation, empty state, prospect links, and Complete/Reopen controls. Preserve active filters in pagination links.

- [ ] **Step 2: Build prospect Pipeline and Deal card**

Use `getProspectPipelineDetail`; archived prospects display read-only stage/Deal context plus Restore guidance. Active prospects render stage move controls and Deal edit fields only at Interested or later. Won/Lost show closing context. Currency form values are dollars with two decimals, derived from cents.

- [ ] **Step 3: Build prospect Tasks card**

Create/edit forms use exact title 160, `datetime-local` input converted with `zonedLocalInputToIso` before submission, and priority select. Existing dates render through `dateToZonedLocalInput`. Lists separate open/completed, show safe feedback, and provide Complete/Reopen. Editing never exposes prospect linkage or status fields.

- [ ] **Step 4: Replace dashboard shell with operational metrics**

Retain a compact account identity area, then render linked metrics for overdue, due today, active prospects, and formatted open Deal value. Links must be `/tasks?status=OVERDUE`, `/tasks?status=DUE_TODAY`, and `/pipeline`.

- [ ] **Step 5: Add nav and focused UI-state tests**

Add Tasks alongside Pipeline. Test task datetime conversion around EST/EDT, completion/reopen pending feedback, and Deal currency display/serialization using pure helpers or component tests. Do not test browser date-picker or component-library behavior.

- [ ] **Step 6: Run formatter and verification**

Run:

```bash
bun run fix
bun --filter app typecheck
bun test apps/app/app/actions/tasks.test.ts apps/app/app/actions/pipeline.test.ts 'apps/app/app/(authenticated)/tasks/queries.test.ts' 'apps/app/app/(authenticated)/dashboard/queries.test.ts'
```

Expected: PASS and no formatter changes remaining.

- [ ] **Step 7: Commit**

```bash
git add 'apps/app/app/(authenticated)' 
git commit -m "feat: add task deal and dashboard workspace"
```

---

### Task 8: Documentation, migration deployment, and acceptance verification

**Files:**
- Create: `docs/architecture/0006-m5-pipeline-tasks-deals.md`
- Modify: `README.md`

**Interfaces:**
- Documents: lifecycle migration, stage/deal/task rules, fixed timezone, routes, acceptance flow, and non-goals.

- [ ] **Step 1: Add ADR and README documentation**

Document why pipeline stage lives on Prospect, why Deal is one-to-one, why archive is separate, why controls are explicit instead of drag-and-drop, why tasks remain manual, and why `America/New_York` is fixed for M5. Add `/pipeline` and `/tasks` routes, migration instructions, exact closing/task behavior, and all non-goals.

- [ ] **Step 2: Apply migration to configured test database**

Run: `bun run migrate:deploy` with the configured database environment sourced without printing values.  
Expected: `20260805030000_m5_pipeline_tasks_deals` applies successfully and existing rows map as specified. Query aggregate counts by stage/archive only—never print prospect/contact contents.

- [ ] **Step 3: Run fresh full verification**

Run:

```bash
bun run check
bun run test
SKIP_ENV_VALIDATION=true bun run build
cd packages/database && bunx prisma validate
cd ../.. && git diff --check
```

Expected: all commands exit 0; build lists `/pipeline` and `/tasks`.

- [ ] **Step 4: Run local authenticated browser acceptance**

Using an allowlisted owner session:

1. verify migrated existing rows through active/archive and pipeline views
2. move one active prospect across New, Contacted, Interested, Proposal
3. save optional Deal value/expected date
4. prove Won blocks missing value/date, then succeeds
5. prove Lost requires reason and reopening clears terminal data
6. create/edit/complete/reopen multiple priority Tasks and refresh after each state
7. verify due-today/overdue filters and Dashboard links/counts
8. archive removes the card; restore returns it at the preserved stage
9. verify browser console contains no application errors

No external accounts or side effects are required for M5.

- [ ] **Step 5: Commit docs and inspect branch**

```bash
git add README.md docs/architecture/0006-m5-pipeline-tasks-deals.md
git commit -m "docs: record M5 pipeline task and deal decisions"
git status --short
git log --oneline main..HEAD
git diff --stat main...HEAD
```

Expected: clean tree and only M5 design, persistence, migration, validation, actions, queries, UI, tests, and documentation.

# M6 Dashboard Metrics Design

Date: 2026-08-05  
Status: Approved for implementation planning

## Objective

M6 gives the owner a historical view of how the business is performing, beyond the live operational counts M5 already put on the Dashboard. A new `/reports` page answers three questions: where are prospects getting stuck in the pipeline, how much revenue is closing and at what win rate, and is the owner keeping up with follow-through work.

This spec covers only the dashboard-metrics half of the originally named "M6: Dashboard Metrics and Production Hardening" milestone. Production hardening (monitoring, error tracking, security review, and related operational work) is out of scope here and will be brainstormed as its own, later spec.

## Scope

M6 includes:

- a `PipelineStageChange` history log recording every stage transition, including the initial creation event
- a new owner-scoped `/reports` page with three sections: Pipeline, Revenue, and Activity
- stage funnel counts and stage-to-stage conversion rates
- win rate and a 12-month monthly won-revenue trend
- a 12-month monthly task created-vs-completed trend
- a 12-month monthly audit and outreach-draft volume trend
- explicit empty states for any section with no data

M6 excludes date-range filtering, CSV/export, drill-down detail views, real-time/live updates, a time-in-stage metric, stalled-prospect flagging, a custom report builder, retroactive stage history for prospects that existed before this ships, and the production-hardening half of the original M6 name.

## Architecture

M6 remains inside the single `apps/app` deployment. `/reports` is a read-only Server Component; a new owner-scoped `queries.ts` performs all aggregation with Prisma against PostgreSQL. No new mutations, client data layer, queue, scheduler, or backend application are introduced, and no caching or precomputed-aggregate layer is added — the data volume for a single owner makes on-demand aggregation sufficient.

The one schema addition is `PipelineStageChange`:

- `id`, `userId`, `prospectId`, `fromStage: PipelineStage?` (null on creation), `toStage: PipelineStage`, `changedAt: DateTime`
- indexed on `(userId, prospectId, changedAt)` and `(userId, toStage, changedAt)`

A row is written every time a prospect's stage changes, in the same transaction as the existing mutation so the log can never drift from `Prospect.pipelineStage`:

- `apps/app/app/actions/prospects.ts` (create) writes the initial `fromStage: null → toStage: NEW` row.
- `apps/app/app/actions/pipeline.ts` (move stage, including Won/Lost transitions) writes `fromStage: <previous> → toStage: <new>` on every successful move.

If the history-log write fails, the whole transaction rolls back and the existing safe-error handling from the M5 pipeline action applies unchanged — no new logging fields are needed beyond what M5 already emits for stage moves (owner ID, record IDs, action, destination stage, duration, status).

This is additive-only: existing prospects get no retroactive history, since their first log entry starts whenever M6 ships. Conversion-rate accuracy is therefore limited until enough transitions accumulate after rollout. This is a stated, accepted limitation, not a bug to work around.

## Metric definitions

All queries are owner-scoped (`userId` from `auth()`), read-only, and live in `apps/app/app/(authenticated)/reports/queries.ts`.

- **Stage funnel (snapshot, current):** count of active (non-archived) prospects per stage, `NEW → CONTACTED → INTERESTED → PROPOSAL`, mirroring `/pipeline`'s active-only view. `WON`/`LOST` are shown as separate terminal totals, not part of the funnel bars.
- **Stage conversion rate (snapshot, all-time, includes archived):** for each adjacent pair in the fixed sequence, `reached(B) ÷ reached(A)`, where "reached X" means the owner has at least one `PipelineStageChange` row with `toStage = X` for that prospect. Archived prospects count here because archiving doesn't erase sales history, only visibility.
- **Win rate (trailing 12 months):** `count(Won) ÷ count(Won + Lost)` among Deals whose terminal transition falls in the trailing 12 months — `actualCloseDate` for Won, the Lost transition's `changedAt` from the history log for Lost.
- **Won revenue trend (monthly, trailing 12 months):** sum of `Deal.value` for Won deals, grouped by month of `actualCloseDate`, zero-filled for months with no wins.
- **Task completion trend (monthly, trailing 12 months):** two series — Tasks created (by `createdAt` month) and Tasks completed (by `completedAt` month), zero-filled.
- **Outreach and audit volume (monthly, trailing 12 months):** two series — `WebsiteAudit` count and `OutreachDraft` count, grouped by `createdAt` month, zero-filled.

An owner with zero data in a category sees an explicit empty state on that chart, not a zeroed or misleading chart.

## Page and UI

- New route `apps/app/app/(authenticated)/reports/page.tsx`, owner-scoped like every other route, linked from the Dashboard (a "View reports" link/card) and from the primary navigation alongside Pipeline/Tasks/Prospects.
- Three sections top to bottom, each a `Card` consistent with existing design-system usage:
  1. **Pipeline** — funnel bar chart of current active counts per stage, with conversion-rate percentages labeled between adjacent bars, plus terminal Won/Lost totals as stat tiles.
  2. **Revenue** — win-rate stat tile and the won-revenue monthly trend chart.
  3. **Activity** — the task created-vs-completed trend and the audit/outreach volume trend.
- All charts use the design system's existing `recharts`-based `packages/design-system/components/ui/chart.tsx` wrapper for visual consistency with the rest of the app; no new charting dependency is introduced.
- No filters, date-range pickers, or export in this milestone — one fixed view.
- Empty states render as a centered message inside the card, not an empty chart canvas.

## Error handling, testing, and acceptance

`/reports` is fully read-only — no new mutations, so no new privacy-sensitive log surface. Query failures return a generic safe error, never a raw database error, consistent with existing routes.

Tests prioritize:

- creation writes the initial `null → NEW` history row; every stage move writes an accurate `from → to` row, including backward and skipped-stage moves
- the history write and the stage mutation are atomic — if one fails, both roll back
- funnel counts are owner-scoped, active-only, and exclude archived and terminal prospects
- conversion rate is correct across backward and skipped-move sequences and includes archived prospects
- win rate and revenue trend respect the 12-month window boundary and zero-fill empty months
- task and activity trends zero-fill and remain owner-scoped
- forged or cross-owner IDs never leak into another owner's metrics
- empty-state rendering when a category has no data

Acceptance flow:

- Move prospects through stages, including at least one backward move, and confirm funnel counts and conversion rates update correctly.
- Close deals Won and Lost and confirm win rate and the revenue trend update.
- Complete tasks and run audits/outreach and confirm the two activity trend charts update.
- Refresh `/reports` and confirm it remains owner-scoped.
- Load `/reports` as a fresh owner with no data and confirm empty states render instead of broken or empty charts.
- Checks, tests, migration, and production build pass.

M6 (dashboard-metrics half) excludes date-range filtering, CSV/export, drill-down detail views, real-time/live updates, time-in-stage and stalled-prospect flagging, a custom report builder, and the production-hardening half of M6, which will be scoped as a separate spec.

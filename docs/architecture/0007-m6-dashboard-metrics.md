# ADR 0007: Dashboard metrics via an additive pipeline-stage history log

Status: Accepted

Date: 2026-08-05

## Context

M5 gave every prospect a `pipelineStage` and let the owner move an active prospect to any other fixed stage directly, including backward or skipped-stage moves. That flexibility is a feature for day-to-day sales work, but it means `Prospect.pipelineStage` alone is only ever a current snapshot: it cannot answer "how many prospects have ever reached Proposal" or "what fraction of prospects that reached Contacted went on to reach Interested," because a later move can overwrite evidence of an earlier one. A prospect that goes New → Proposal → Contacted (backward) looks, from the snapshot alone, indistinguishable from one that never reached Proposal at all.

M6 needs exactly those historical, funnel-shaped answers for a new `/reports` page, plus win rate and revenue/activity trends over a trailing 12-month window. None of that is reconstructable from the current snapshot once non-linear moves are allowed.

## Decision

### Record every transition instead of inferring history from the snapshot

Add `PipelineStageChange` — `id`, `userId`, `prospectId`, `fromStage: PipelineStage?` (null only for the creation event), `toStage: PipelineStage`, `changedAt: DateTime` — indexed on `(userId, prospectId, changedAt)` and `(userId, toStage, changedAt)`. A row is written every time a prospect's stage changes:

- `apps/app/app/actions/prospects.ts` writes the initial `fromStage: null → toStage: NEW` row at creation.
- `apps/app/app/actions/pipeline.ts` writes `fromStage: <previous> → toStage: <new>` on every successful stage move, including Won/Lost transitions and backward or skipped-stage moves.

Each write happens in the same Prisma transaction as the mutation it accompanies, so the log can never drift from `Prospect.pipelineStage`: if the history write fails, the whole transaction rolls back and the existing M5 safe-error handling for stage moves applies unchanged. This is the only way to answer "has this prospect ever reached stage X" once stage moves are non-linear — a snapshot column fundamentally cannot represent "reached and later left."

### Additive-only, with no backfill for existing prospects

Migration `20260805050000_m6_pipeline_stage_history` only creates the new table, its two indexes, and its foreign key to `Prospect`. It does not touch `Prospect`, does not drop anything, and does not synthesize history rows for prospects that existed before this migration ships. Those prospects simply have no `PipelineStageChange` rows until their next stage move (or none, if they never move again).

This is a deliberate, accepted limitation rather than a gap to close later: any backfill would have to guess `changedAt` timestamps for transitions that were never recorded, which would misrepresent real sales history as precisely as the transitions LeadForge did capture. Conversion-rate accuracy is therefore limited until enough real transitions accumulate after rollout — reports on day one may undercount "reached" totals for long-lived prospects, and that is expected, not a bug.

### Conversion-rate and win-rate formulas

- **Stage funnel** (snapshot, current): count of active (non-archived) prospects per stage in the fixed sequence `NEW → CONTACTED → INTERESTED → PROPOSAL`. `WON` and `LOST` are reported as separate terminal totals, not funnel bars.
- **Stage conversion rate** (all-time, includes archived): for each adjacent pair `(A, B)` in the fixed sequence, `reached(B) ÷ reached(A)`, where "reached X" means the owner has at least one `PipelineStageChange` row with `toStage = X` for that prospect. The rate is `null` when `reached(A)` is 0. Archived prospects are included here because archiving hides a prospect from `/pipeline`, it does not erase that it once passed through these stages. Because M5 allows skipped-stage moves and because prospects created before this migration shipped have no logged initial "reached NEW" event, `reached(B) ÷ reached(A)` can mathematically exceed 100%; the UI clamps the displayed percentage at 100% (the underlying stored ratio is left unclamped), so this metric is a useful directional signal, not an exact historical measurement, until enough post-launch history accumulates.
- **Win rate** (trailing 12 months): `won ÷ (won + lost)`, where a Deal counts as Won in the window if its `actualCloseDate` falls in the trailing 12 months, and as Lost if the most recent `PipelineStageChange` row with `toStage = LOST` for a prospect currently in the `LOST` stage falls in the trailing 12 months (Deal has no dedicated lost-date field, so the history log is the source of truth for when a loss happened).
- **Won revenue trend** (monthly, trailing 12 months): sum of `Deal.valueCents` for Won deals, grouped by month of `actualCloseDate`, zero-filled for months with no wins.
- **Task and activity trends** (monthly, trailing 12 months): Tasks created (by `createdAt` month) vs. completed (by `completedAt` month), and `WebsiteAudit`/`OutreachDraft` counts (by `createdAt` month), all zero-filled.

All trend buckets use UTC calendar months over the trailing 12 months. This intentionally does not reuse M5's fixed `America/New_York` product timezone — that timezone exists specifically for Task due-today/overdue boundaries and has no bearing on monthly trend aggregation here.

### On-demand aggregation, no caching layer or scheduler

Every `/reports` query runs live against PostgreSQL through a new owner-scoped `apps/app/app/(authenticated)/reports/queries.ts`, with no precomputed-aggregate table, cache, background job, or scheduler. LeadForge is a single-owner workspace, so the data volume behind any one owner's metrics is small enough that on-demand aggregation is well within acceptable latency for a Server Component page load. Adding a caching or scheduling layer now would introduce staleness questions and an invalidation surface (when does a stage move or Deal close invalidate a cached figure?) for a problem the current scale does not have. This can be revisited if a future milestone changes the scale assumption.

## Non-goals

M6 (dashboard-metrics half) does not add date-range filtering, CSV/export, drill-down detail views, real-time/live updates, a time-in-stage metric, stalled-prospect flagging, a custom report builder, retroactive stage history for prospects that existed before this ships, or the production-hardening half of the originally combined "M6: Dashboard Metrics and Production Hardening" milestone (monitoring, error tracking, security review), which is scoped separately.

## Consequences

`/reports` gets an accurate, append-only source of truth for pipeline history without duplicating or risking drift against `Prospect.pipelineStage`, at the cost of an accepted gap in historical depth for prospects that predate this migration. Keeping aggregation on-demand and uncached avoids a staleness/invalidation problem the current single-owner scale does not require solving, while leaving the door open to add caching later if data volume changes that calculus.

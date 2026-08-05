# ADR 0006: Owner-operated pipeline, tasks, and deals

Status: Accepted

Date: 2026-08-04

## Context

M4 leaves LeadForge with owner-scoped prospects and evidence-grounded outreach drafts, but no durable way to represent sales progress, a commercial outcome, or the next manual follow-up. M5 needs one coherent workflow inside the existing application without turning the private single-owner workspace into a general-purpose CRM or adding another service.

The previous `ProspectStatus` mixed sales progress (`NEW` and `QUALIFIED`) with record visibility (`ARCHIVED`). That makes restoring a record destructive to its former sales context and cannot express the stages needed for an owner-operated pipeline.

## Decision

- Store `pipelineStage` directly on `Prospect` with the fixed stages `NEW`, `CONTACTED`, `INTERESTED`, `PROPOSAL`, `WON`, and `LOST`. Every prospect has sales progress, including before a Deal exists, so the lifecycle belongs to the prospect rather than an optional financial record.
- Store archive state separately as nullable `Prospect.archivedAt`. Archiving controls visibility, not sales progress: archive sets the timestamp without changing the stage, restore clears it, and the prospect returns at the preserved stage. Archived prospects are absent from `/pipeline`, and their pipeline, Deal, and Task controls remain read-only until restore.
- Allow one optional `Deal` per prospect, enforced by a unique `prospectId`. M5 treats one prospect as one sales opportunity, so one Deal prevents conflicting values or close outcomes while still avoiding empty Deal rows for early-stage prospects. Both the prospect and Deal remain scoped by the authenticated owner ID.
- Keep pipeline movement explicit and non-linear. The owner may move an active prospect directly to any other fixed stage, including backward or skipped stages. Select-and-submit controls make the destination and any closing requirements visible before mutation, work without pointer gestures, and avoid a drag-and-drop dependency.
- Keep Tasks manual. A prospect may have many Tasks, but stage changes, Deal changes, outreach actions, and other workflows never create, update, complete, or reopen Tasks automatically. The owner explicitly creates, edits, completes, and reopens each next action.
- Use the fixed product timezone `America/New_York` for M5 Task entry, display, due-today boundaries, and Dashboard counts. One tested timezone makes results independent of the server or developer machine timezone while per-user timezone settings remain deferred. Instants are persisted in UTC; Due today is local midnight inclusive through the next local midnight exclusive, and Overdue is any open Task whose due instant has passed. An open Task earlier today can therefore match both concepts in their dedicated views.
- Keep all owner-scoped reads and server-authorized mutations in the existing `apps/app` deployment, with Prisma and PostgreSQL as the persistence boundary. M5 adds no client data layer, queue, scheduler, backend application, external account, or deployment.

## Lifecycle migration

Migration `20260805030000_m5_pipeline_tasks_deals` adds and backfills `pipelineStage` and `archivedAt` before removing `Prospect.status` and `ProspectStatus`, then creates the Deal and Task persistence model. Existing rows map as follows:

- `NEW` becomes `pipelineStage = NEW` with `archivedAt = null`.
- `QUALIFIED` becomes `pipelineStage = INTERESTED` with `archivedAt = null`.
- `ARCHIVED` becomes `pipelineStage = NEW` with `archivedAt` set to the migration timestamp.

Migration `20260805040000_m5_task_priority_sort_order` changes the PostgreSQL Task priority enum order to `HIGH`, `MEDIUM`, `LOW` so database ordering matches product priority without changing stored labels. Apply both pending migrations to an existing configured database with `bun run migrate:deploy`. Use `bun run migrate` only for local schema-development work.

## Pipeline and Deal rules

- New and Contacted do not expose Deal editing.
- Interested and Proposal allow an optional positive USD value, stored as integer cents, and an optional expected close date. Saving either field upserts the single Deal; blank optional fields remain null.
- Moving to Won requires a positive Deal value and an actual close date. The stage and Deal close data persist atomically, and the transition clears any loss reason.
- Moving to Lost requires a trimmed loss reason of at most 500 characters. The transition clears any actual close date and retains non-terminal Deal fields such as value and expected close date.
- Moving from Won or Lost to a non-terminal stage clears both terminal fields (`actualCloseDate` and `lossReason`) while retaining the Deal record, value, and expected close date. Moving to New or Contacted hides Deal editing until the prospect reaches Interested again.
- Deal fields are editable only at Interested, Proposal, Won, or Lost. Edits at Won must retain a positive value and existing actual close date; edits at Lost must retain an existing loss reason.
- Stage and Deal mutations authorize the Clerk allowlisted owner, reload relationships and current state server-side, reject archived prospects, and commit terminal state atomically.

## Task rules

- Each Task belongs to one owned prospect and requires a trimmed title of at most 160 characters, a due date/time, and a `HIGH`, `MEDIUM`, or `LOW` priority.
- Creating a Task requires an active prospect. The browser cannot replace its owner, prospect relationship, status, or completion timestamp.
- Completing an open Task sets `status = COMPLETED` and `completedAt` to the current instant. Reopening a completed Task sets `status = OPEN` and clears `completedAt`. Completed Tasks are retained; M5 does not permanently delete Tasks.
- `/tasks` offers Open, Due today, Overdue, and Completed views, optionally filtered by priority, with 25 rows per page. Open results sort by due time, priority, creation time, then ID; completed results sort by completion time descending, then ID.
- Prospect detail is the Task creation and editing hub. The global list links back to it and exposes only Complete/Reopen state controls.

## Routes and acceptance

`/pipeline` is the owner-scoped six-column board for active prospects. Cards show contact/website context, Deal value, open-Task count, and nearest due Task when present. `/tasks` is the owner-scoped, filterable follow-up queue. Prospect detail remains the editing surface for pipeline, Deal, and Task data, while Dashboard cards link to filtered Task views and Pipeline and show overdue count, due-today count, active-prospect count, and open Deal value for active Interested/Proposal prospects.

Acceptance applies both migrations, verifies aggregate legacy-row mappings, moves an active owned prospect through the pipeline, exercises Won/Lost validation and reopening, persists optional Deal fields, creates and cycles multiple priority Tasks through edit/complete/reopen with refreshes, checks due-state filters and Dashboard links/counts, and confirms archive removes and restore returns the card at its preserved stage. Browser acceptance also checks for application console errors. No external accounts or external side effects are required.

## Consequences

LeadForge gains a small, auditable sales operating loop without duplicating lifecycle state or hiding terminal requirements inside an implicit gesture. Separating archive state preserves history, one Deal keeps financial state unambiguous, explicit controls protect accessibility and server validation, and manual Tasks keep the owner in control. The fixed timezone is intentionally simple for M5 but will need a separate product decision before the application supports owners in other zones.

## Non-goals

M5 does not add drag-and-drop, automatic Task creation, sending or tracking outreach, multiple Deals per prospect, customizable stages, permanent deletion, reminders, notifications, calendar sync, charts, forecasting analytics, QStash, webhooks, or another service. These capabilities require separate product and operational decisions.

# M5 Pipeline, Tasks, and Deals Design

Date: 2026-08-04  
Status: Approved for implementation planning

## Objective

M5 turns LeadForge's prospect records into a lightweight owner-operated sales workflow. The owner can move prospects across a fixed pipeline, track one deal after genuine interest, manage manual next-action tasks, and see immediate operational counts on the dashboard.

The milestone validates one coherent workflow rather than a general CRM: one prospect represents one active sales opportunity, one optional deal, and many manually managed tasks.

## Scope

M5 includes:

- a fixed six-stage prospect pipeline
- archive state separated from pipeline stage
- one optional deal per prospect
- explicit Won and Lost closing requirements
- multiple prospect-linked tasks with priorities and due dates
- a Kanban-style pipeline using accessible explicit move controls
- a global task list and prospect-level task management
- owner-scoped dashboard operational counts

M5 excludes drag-and-drop, automatic task creation, sending/tracking outreach, multiple deals per prospect, customizable stages, permanent deletion, reminders, notifications, calendar sync, analytics charts, QStash, webhooks, and separate services.

## Architecture

M5 remains inside the single `apps/app` deployment. Server Components perform owner-scoped reads; server actions authorize, validate, and mutate pipeline, deal, and task records. Prisma and PostgreSQL remain the persistence boundary. No client data layer, queue, scheduler, or backend application is introduced.

The implementation is divided into focused boundaries:

1. prospect lifecycle and migration
2. pipeline/deal mutations and queries
3. task mutations and queries
4. pipeline, task, prospect-detail, and dashboard UI

## Prospect lifecycle migration

The current `ProspectStatus` combines sales progress and archive state. M5 replaces it with:

- `pipelineStage`: `NEW | CONTACTED | INTERESTED | PROPOSAL | WON | LOST`
- `archivedAt`: nullable timestamp

The migration preserves existing intent:

- `NEW` becomes `pipelineStage = NEW`, `archivedAt = null`
- `QUALIFIED` becomes `pipelineStage = INTERESTED`, `archivedAt = null`
- `ARCHIVED` becomes `pipelineStage = NEW`, `archivedAt` set to the migration timestamp

The migration adds and backfills the new columns before removing the old enum column and enum type. Existing active/archive list behavior is rewritten to filter by `archivedAt`, while pipeline filtering uses `pipelineStage`.

Archiving sets `archivedAt` without changing `pipelineStage`. Restoring clears `archivedAt`, revealing the stored stage again. Archived prospects do not appear on the pipeline and cannot be moved or have pipeline/deal state changed until restored.

## Deal data model

`Deal` is optional and one-to-one with a prospect:

- `id`
- `userId`
- `prospectId`, unique
- `valueCents`, nullable positive integer
- `expectedCloseDate`, nullable date/time
- `actualCloseDate`, nullable date/time
- `lossReason`, nullable bounded string
- `createdAt`
- `updatedAt`

Every query and mutation scopes both the deal and prospect by authenticated owner ID. The database uses a unique prospect ID to enforce one deal per prospect; application actions use authenticated `userId` for defense in depth.

Deal editing is available only at `INTERESTED`, `PROPOSAL`, `WON`, or `LOST`. Saving deal details at Interested or Proposal upserts the Deal. Empty optional values remain null. Money is stored as integer cents and formatted as currency at the UI boundary.

## Pipeline transitions

Pipeline movement is explicit but not artificially linear. The owner may move an active prospect to any valid stage, including backward movement or skipped stages.

Rules:

- `NEW` and `CONTACTED` do not expose deal editing.
- `INTERESTED` and `PROPOSAL` allow optional value and expected close date.
- moving to `WON` requires a positive deal value and actual close date
- moving to `LOST` requires a trimmed loss reason
- moving away from `WON` clears `actualCloseDate`
- moving away from `LOST` clears `lossReason`
- moving to `NEW` or `CONTACTED` retains the Deal record and its non-terminal value/expected-close fields for history, but hides deal editing until Interested again
- stage changes never create, update, or complete tasks automatically
- archived prospects cannot transition

The transition action accepts a prospect ID, destination stage, and only the closing fields required for Won/Lost. It reloads the owned prospect and any owned Deal server-side. Browser-submitted owner IDs, current stage, deal linkage, stored deal fields, and closing timestamps are not trusted.

The stage update and Deal upsert/update run atomically in a database transaction so a closed stage cannot persist without its required closing data.

## Task data model

`Task` represents a manual next action:

- `id`
- `userId`
- `prospectId`
- `title`
- `dueAt`
- `priority`: `LOW | MEDIUM | HIGH`
- `status`: `OPEN | COMPLETED`
- `completedAt`, nullable
- `createdAt`
- `updatedAt`

Multiple tasks may belong to one prospect. Task creation and editing require a trimmed title, due date/time, and priority. Completing a task atomically sets `status = COMPLETED` and `completedAt = now`; reopening sets `status = OPEN` and clears `completedAt`. The server ignores browser-submitted owner IDs, prospect replacement on edit, status, and completion timestamps.

Permanent deletion is excluded. Completed tasks preserve operational history.

## Due-date semantics

Task due states use the fixed M5 product timezone `America/New_York`:

- Due today: `dueAt` falls from local midnight inclusive to the next local midnight exclusive.
- Overdue: task is open and `dueAt` is before the current instant.
- An overdue task may also have today's calendar date; the dedicated Due Today filter includes all open tasks on today's local date, while Overdue includes every open task whose instant has passed.

Timezone boundary calculations live in one tested helper. Tests inject the current instant and cover daylight-saving offset behavior rather than relying on the machine clock.
Per-user timezone configuration is deferred; server deployment timezone does not change these calculations.

## Pipeline experience

`/pipeline` is a six-column Kanban-style board:

- New
- Contacted
- Interested
- Proposal
- Won
- Lost

The board uses horizontally scrollable columns on narrow screens. It does not add a drag-and-drop dependency. Each card shows:

- business name
- contact name when present
- hostname when present
- open-task count
- nearest open task due date
- deal value when present

An explicit **Move to…** control exposes valid destinations and invokes the server-authorized transition action. Won and Lost selection opens or reveals the required closing fields before submission. Cards link to prospect detail for full editing.

Pipeline queries return active prospects only, group them by stage, and use deterministic ordering within each stage: nearest open task, prospect update time descending, then prospect ID.

## Prospect detail experience

Prospect detail remains the editing hub and gains two focused sections.

### Pipeline and Deal

- current stage and explicit move control
- deal value and expected close date at Interested or later
- actual close date for Won
- loss reason for Lost
- safe validation and persistence feedback

### Tasks

- create task form
- open tasks sorted by due state, due time, priority, and creation time
- completed tasks sorted by completion time descending
- edit title/due time/priority
- Complete and Reopen controls

Archiving/restoring remains available and preserves pipeline stage, Deal, and Tasks.

## Global task experience

`/tasks` provides owner-scoped filters:

- Open
- Due today
- Overdue
- Completed
- Priority

Filters may be combined where meaningful; Completed is exclusive of open due-state filters. Query parameters are normalized to safe defaults. Results paginate at 25 rows and use deterministic ordering.

Each row shows title, prospect, due date/time, priority, status, and Complete/Reopen controls. Rows link to the prospect detail. Editing remains on prospect detail to keep the global list compact.

## Dashboard metrics

The authenticated dashboard adds four owner-scoped operational metrics:

- overdue open tasks
- open tasks due today
- active pipeline prospects (`archivedAt = null`)
- total open deal value for active prospects in `INTERESTED` or `PROPOSAL`

Won revenue and Lost deals are excluded from open pipeline value. Metrics are direct database aggregates, not a new analytics subsystem. Task counts link to filtered `/tasks` views; pipeline counts and open deal value link to `/pipeline`.

## Authorization and input trust

Every mutation derives `userId` exclusively from `auth()` and checks the Clerk allowlist. Every query includes `userId`; related records are verified against the same owner.

Browser input is limited to opaque record IDs and fields the owner is currently editing. The server ignores and reloads:

- owner identity
- prospect/deal/task relationships
- current pipeline stage
- archive state
- existing Deal values
- Task status and completion timestamps

Missing and other-owner records return the same safe not-found/authorization behavior to prevent disclosure.

## Error handling and observability

Actions return stable messages for authorization, validation, missing records, invalid transitions, and database failures. Expected validation failures do not throw. Transactions prevent partial stage/deal changes.

Structured logs include only owner ID, record IDs, action, destination stage, duration, status, and a safe failure code. Logs exclude task titles, loss reasons, deal values, prospect notes, contact details, submitted form values, and raw database errors.

## Testing strategy

Tests focus on LeadForge-owned behavior:

- data migration mapping for New, Qualified, and Archived rows
- owner-scoped pipeline, deal, task, and dashboard queries/mutations
- forged owner/prospect/deal IDs and completion timestamps ignored
- valid stage destinations and archived-prospect transition blocking
- Won value/close-date and Lost reason requirements
- clearing stale Won/Lost fields when reopening
- atomic stage plus Deal persistence
- task create/edit/complete/reopen behavior
- due-today and overdue timezone/DST boundaries
- deterministic task ordering, pagination, and pipeline grouping
- safe database errors and sanitized logging
- no automatic Task mutations during stage/deal/outreach actions

Tests do not merely verify Prisma, Zod, Clerk, date libraries, or UI component-library behavior.

## Acceptance flow

1. Apply the migration and confirm existing New, Qualified, and Archived prospects map correctly.
2. Move an owned active prospect through New, Contacted, Interested, and Proposal.
3. Save optional value and expected close date at Interested/Proposal.
4. Confirm Won is blocked without positive value and actual close date, then close successfully.
5. Close a prospect as Lost with a reason, reopen it, and confirm terminal data clears.
6. Create multiple prioritized tasks, edit them, complete/reopen them, and verify refresh persistence.
7. Verify Pipeline, Tasks, prospect detail, and Dashboard metrics use real owner-scoped data.
8. Archive a prospect and confirm it leaves the pipeline; restore it and confirm the stored stage returns.
9. Confirm unrelated actions do not change pipeline stages or tasks.
10. Run checks, tests, migration deployment, production build, and the single Vercel deployment smoke flow.

## Deferred work

M5 does not add drag-and-drop, automatic task creation, sending/tracking outreach, multiple deals per prospect, customizable stages, permanent deletion, reminders, notifications, calendar sync, charts, forecasting analytics, QStash, webhooks, or another service. These require separate product and operational decisions.

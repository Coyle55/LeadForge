# LeadForge

LeadForge is a private, single-owner lead workspace. M0 established authentication and persistence, M1 added manual prospect management, M2 added deterministic website audits, M3 turns completed audit evidence into AI-generated opportunity scoring and recommendations, M4 prepares editable outreach drafts from one selected recommendation, and M5 adds a fixed sales pipeline, one optional Deal per prospect, and manual follow-up Tasks.

## Requirements

- Bun 1.3.14
- Node.js 20.19+, 22.12+, or 24+ (Prisma 7 does not support Node 23)
- A Clerk application
- A PostgreSQL database, with Neon recommended

## Local setup

```bash
bun install
cp apps/app/.env.example apps/app/.env.local
cp packages/database/.env.example packages/database/.env
```

Fill both environment files with the same `DATABASE_URL`. In `apps/app/.env.local`, add the Clerk publishable and secret keys and set `ALLOWED_USER_IDS` to the Clerk owner ID (`user_...`). Multiple IDs may be comma-separated, although M0 is designed for one owner.

Apply the schema and start the app:

```bash
bun run migrate
bun dev --filter app
```

The dashboard runs at `http://localhost:3000`. Prisma Studio is available without a separate application:

```bash
bun run db:studio
```

The authenticated application routes are:

- `/` — account and database overview
- `/pipeline` — six-stage active-prospect pipeline and explicit stage controls
- `/tasks` — filterable owner-scoped follow-up queue
- `/prospects` — searchable, archive- and pipeline-stage-filtered prospect list
- `/prospects/new` — create a prospect
- `/prospects/[id]` — edit, archive, or restore an owned prospect
- `/audits` — owner-scoped website audit history
- `/audits/[id]` — grouped audit evidence and rerun controls
- `/opportunities` — completed and failed opportunity-analysis history
- `/opportunities/[id]` — evidence-linked score and recommendations
- `/outreach` — completed and failed outreach-draft history
- `/outreach/[id]` — edit, copy, or reset an evidence-grounded draft
- `/reports` — pipeline funnel/conversion, win rate, revenue, and activity trends over the trailing 12 months
- `/settings` — update the owner's display name and Outreach Profile

## Commands

```bash
bun run check
bun run fix
bun run test
bun run build
bun run migrate
bun run migrate:deploy
bun run db:studio
```

## External account setup

These steps require the repository owner's credentials and are intentionally not automated by M0 implementation.

### Clerk

1. Create a Clerk application and enable email-based sign-in.
2. Copy the publishable key and secret key into `apps/app/.env.local`.
3. Set Clerk's sign-in URL to `/sign-in`, sign-up URL to `/sign-up`, and after-sign-in/after-sign-up URL to `/`.
4. Create or sign in as the owner, copy their Clerk user ID from the Clerk dashboard, and set `ALLOWED_USER_IDS=user_...`.
5. Do not configure a webhook for M0.

### Neon

1. Create a Neon project and database.
2. Copy its pooled PostgreSQL connection string into `DATABASE_URL` in both local environment files.
3. Run `bun run migrate` locally. For production, set the production URL temporarily in the shell and run `bun run migrate:deploy` before the first production smoke test.

### Vercel

1. Import this Git repository as one Vercel project.
2. Set Root Directory to `apps/app` and retain access to source files outside the root so workspace packages build.
3. Add `DATABASE_URL`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`, `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/`, `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/`, `NEXT_PUBLIC_APP_URL`, and `ALLOWED_USER_IDS` for Production and Preview as appropriate.
4. For M3 analysis and M4 outreach generation, enable AI Gateway for the project and add `AI_GATEWAY_MODEL` using a model ID currently available to that Gateway. For local development outside Vercel, create an AI Gateway API key and add it as `AI_GATEWAY_API_KEY`; Vercel deployments may use the platform's Gateway authentication. M4 reuses this existing configuration and requires no new external account.
5. Deploy once the production migration has been applied.

## M0 acceptance flow

- A signed-out visitor is redirected to sign-in.
- A signed-in Clerk ID absent from `ALLOWED_USER_IDS` sees access denied.
- The allowlisted owner reaches Dashboard immediately, without a webhook.
- `ensureCurrentUser()` creates or updates the local row and primary email.
- Dashboard displays the stored email, display name, and timestamps.
- Settings updates `displayName`, and the value persists after refresh.
- `bun run check`, `bun run test`, and `bun run build` pass.
- One Vercel deployment rooted at `apps/app` passes the same flow.

## M0 non-goals

M0 has no prospecting, audits, AI, QStash, storage, outreach, tasks, deals, analytics, placeholder navigation, webhooks, or separate backend services.

## M1 acceptance flow

- The owner creates a prospect and sees it first in the Active list.
- Search and status filters return only owner-scoped records.
- Editing persists after refresh.
- Archiving removes the record from Active; Archived shows it; Restore returns it to Active.
- Missing and other-owner records are not disclosed.
- `bun run check`, `bun run test`, and `bun run build` pass.
- `bun run migrate:deploy` applies the M1 prospect migration before deployment.

M1 remains manual-only: no CSV workflow, discovery provider, audit, AI, outreach, task, deal, analytics, webhook, QStash, storage, or separate backend application is included.

## M2 website audits

M2 adds synchronous, user-triggered website audits for owned prospects. LeadForge validates public targets, respects robots.txt, crawls at most five same-origin HTML pages, and stores immutable pass/warning/fail findings across accessibility, trust, SEO, technical health, and HTTP/HTML performance indicators.

No new environment variables or external accounts are required. M2 deliberately does not claim Lighthouse or Core Web Vitals results and adds no overall score, AI recommendation, screenshot, queue, webhook, storage service, or separate deployment.

### M2 acceptance flow

- Open a prospect with a public website and select Run audit.
- A completed run redirects to `/audits/[id]` with 27 grouped deterministic checks.
- Refresh preserves the result; `/audits` shows immutable run history newest first.
- Run again creates another audit rather than overwriting evidence.
- Private, local, robots-blocked, unreachable, oversized, and timed-out targets fail with safe stored messages.
- All audit reads and writes remain scoped to the authenticated Clerk owner ID.

Synchronous execution is capped at five pages, five redirects per request, two megabytes per response, five seconds per request, and twenty seconds for the run. Larger browser-based or asynchronous audits are deferred.

## M3 opportunity scoring

M3 adds a manual **Analyze opportunity** action to completed audits. It sends only minimized audit evidence through the Vercel AI Gateway and persists an immutable assessment: an overall 0–100 opportunity score, accessibility/trust/SEO/technical/performance scores, rationale, and three to seven prioritized recommendations linked back to source checks. Higher scores mean more addressable sales opportunity—not better website quality.

Set these values locally in `apps/app/.env.local` and in the Vercel project when enabling analysis:

```bash
AI_GATEWAY_MODEL=provider/current-model-id
AI_GATEWAY_API_KEY=replace_for_local_development
```

There is intentionally no built-in model default. Choose a model enabled for your Gateway and keep the value configurable. Without these credentials, prospect management and deterministic audits continue to work; the analysis action returns a safe configuration error.

### M3 acceptance flow

- Open a completed audit and select **Analyze opportunity**.
- A valid structured response redirects to `/opportunities/[id]` and persists across refresh.
- The detail page shows the overall score, all five category scores, rationale, and three to seven ordered recommendations.
- Recommendation evidence links return to the exact source audit checks.
- Failed, timed-out, rate-limited, or invalid responses create a failed attempt without a fabricated score.
- `/opportunities` lists owner-scoped completed or failed attempts newest first.
- Logs record identifiers, model, prompt version, duration, token counts, and safe failure classifications without prompt or generated content.
- `bun run check`, `bun run test`, `bun run build`, and `bun run migrate:deploy` pass.

M3 remains synchronous and manually initiated. Outreach, autonomous execution, QStash, webhooks, callbacks, screenshots, storage, tasks, deals, analytics, and separate backend services remain deferred.

## M4 outreach generation

M4 adds a manual **Draft outreach** action to each recommendation in a completed opportunity analysis. The owner selects one recommendation so the email stays focused, evidence sent to the model remains bounded, and the owner retains control over the sales angle. Before generation, the prospect must have both a contact name and contact email and the owner must save a complete Outreach Profile in Settings.

Each successful request returns exactly one concise plain-text subject and body. LeadForge stores the original generated values as an immutable snapshot and creates a separate editable working copy. Save changes only the working copy, Reset restores it from the original generation, and drafting again creates a new history record instead of overwriting prior work.

M4 reuses the M3 AI Gateway settings:

```bash
AI_GATEWAY_MODEL=provider/current-model-id
AI_GATEWAY_API_KEY=replace_for_local_development
```

Local development outside Vercel uses the Gateway API key; Vercel deployments may use platform Gateway authentication. There is no built-in model default and no new external account is required for M4. Without valid AI configuration, the rest of LeadForge—including profile settings and existing outreach history—continues to work, while generation returns a safe configuration or Gateway error. Generation remains a single synchronous request with no automatic paid retry.

Apply `20260805010000_m4_outreach_generation` with `bun run migrate:deploy` before local acceptance against the configured test database or before production traffic.

### M4 acceptance flow

1. Open Settings, complete all five Outreach Profile fields, save, and confirm the values persist after refresh.
2. Open a completed opportunity for a prospect without a contact name or contact email and confirm Draft outreach is blocked with a link to add both fields.
3. Add the contact name and email, return to the completed opportunity, select one recommendation, and choose Draft outreach.
4. Confirm the resulting detail contains exactly one subject and one plain-text body grounded in that recommendation, then refresh and confirm both persist.
5. Edit the working subject/body, save, refresh, and confirm the edits persist.
6. Reset the draft, refresh, and confirm the immutable original generation is restored.
7. Return to the source recommendation, draft again, and confirm `/outreach` contains a second, separate history record.
8. On `/outreach`, inspect both Completed and Failed filters and confirm records are owner-scoped and newest first.
9. Confirm failed attempts show safe failure context without fabricated subject/body content, and confirm the browser console has no application errors.
10. Run `bun run check`, `bun run test`, `SKIP_ENV_VALIDATION=true bun run build`, `git diff --check`, and `bun run migrate:deploy`; confirm the production build lists `/outreach` and `/outreach/[id]`.

M4 only prepares drafts; it never sends email. Email providers, sequences, follow-ups, HTML email, contact discovery, bulk generation, autonomous outreach, delivery/open tracking, unsubscribe management, QStash, webhooks, callbacks, tasks, deals, analytics, and additional services remain deferred.

## M5 pipeline, tasks, and deals

M5 turns each owned prospect into one lightweight sales opportunity. `Prospect.pipelineStage` stores one of New, Contacted, Interested, Proposal, Won, or Lost, while nullable `archivedAt` independently controls active/archive visibility. Archiving preserves the stage, Deal, and Tasks; restoring returns the prospect to its stored stage. Archived prospects do not appear on `/pipeline` and remain read-only until restored.

A prospect may have one optional Deal and many manually managed Tasks. Deal editing begins at Interested. Interested and Proposal accept an optional positive USD value and expected close date. Moving to Won requires a positive value and actual close date; moving to Lost requires a trimmed loss reason. Won clears a prior loss reason, Lost clears a prior actual close date, and moving either terminal stage back to New, Contacted, Interested, or Proposal clears both terminal fields while preserving the Deal value and expected close date. No stage or Deal action creates or changes a Task.

Tasks require a title, due date/time, and High, Medium, or Low priority. Complete sets the Task to Completed with the current completion time; Reopen returns it to Open and clears that timestamp. Task entry, display, Due today boundaries, and Dashboard counts use the fixed M5 timezone `America/New_York`; Due today spans local midnight inclusive to the next local midnight exclusive, while Overdue includes every open Task whose due instant has passed.

M5 requires no new environment variables, external accounts, or services. Apply both M5 migrations to the configured database before local acceptance or production traffic:

```bash
bun run migrate:deploy
```

This deploys `20260805030000_m5_pipeline_tasks_deals`, which maps legacy `NEW` to New, `QUALIFIED` to Interested, and `ARCHIVED` to New plus a migration-time `archivedAt`, followed by `20260805040000_m5_task_priority_sort_order`, which establishes High-to-Low database priority order. Use `bun run migrate` only while developing a new local migration.

### M5 acceptance flow

1. Apply both migrations and verify legacy New, Qualified, and Archived rows by aggregate stage/archive counts only.
2. In `/pipeline`, move one active prospect through New, Contacted, Interested, and Proposal using the explicit controls.
3. At Interested or Proposal, save an optional Deal value and expected close date and confirm both persist after refresh.
4. Confirm Won is blocked without a positive value and actual close date, then supply both and close successfully.
5. Confirm Lost requires a reason, then reopen the prospect to a non-terminal stage and confirm actual close date and loss reason are cleared while value/expected close remain.
6. From prospect detail, create and edit multiple Tasks across High, Medium, and Low priority; complete and reopen them, refreshing after every state change to confirm persistence.
7. In `/tasks`, verify Open, Due today, Overdue, Completed, and priority filters. Confirm Dashboard counts link to the matching Task views and `/pipeline` and that open Deal value includes only active Interested/Proposal prospects.
8. Archive the prospect and confirm its card leaves `/pipeline`; restore it and confirm the card returns at the preserved stage with Deal and Task history intact.
9. Confirm the browser console contains no application errors, then run `bun run check`, `bun run test`, `SKIP_ENV_VALIDATION=true bun run build`, Prisma validation, and `git diff --check`.

M5 does not add drag-and-drop, automatic Task creation, sending or tracking outreach, multiple Deals per prospect, customizable stages, permanent deletion, reminders, notifications, calendar sync, charts, forecasting analytics, QStash, webhooks, or another service. All reads and mutations remain owner-scoped inside the existing `apps/app` deployment.

# LeadForge M3 AI Opportunity Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit, owner-scoped AI opportunity analysis for completed audits through Vercel AI Gateway, with immutable scores and evidence-linked recommendations.

**Architecture:** Focused server-only modules in `apps/app` minimize audit evidence, construct a versioned prompt, invoke structured generation, and validate evidence references. A Server Action owns authorization and immutable Prisma persistence; Server Components render history and details.

**Tech Stack:** Bun, TypeScript, Vitest, Next.js 16 App Router, Clerk, Prisma 7/PostgreSQL, Vercel AI SDK and AI Gateway, Zod, structured console logging.

## Global Constraints

- Require explicit `AI_GATEWAY_MODEL`; never hardcode a production model.
- Use `AI_GATEWAY_API_KEY` locally or Vercel OIDC in production; never commit credentials.
- Model calls are manual, synchronous, timeout-bounded, and never automatically retried.
- Never send contact details, notes, Clerk data, database IDs, secrets, or raw URLs with query strings to the model.
- Store only schema-valid structured results; never store raw responses or chain-of-thought.
- Never display a deterministic fallback or partial score after AI failure.
- Keep one deployment and add no queue, webhook, callback app, worker, or storage integration.
- Automated tests inject generation fixtures and spend no tokens.

---

### Task 1: Opportunity persistence and environment contract

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260804230000_m3_opportunity_analysis/migration.sql`
- Modify: `apps/app/env.ts`
- Modify: `apps/app/.env.example`

**Interfaces:**
- Produces `OpportunityAnalysisStatus`, `RecommendationLevel`, `OpportunityAnalysis`, and `OpportunityRecommendation` exactly as specified.
- Produces validated server environment values `AI_GATEWAY_MODEL` and optional `AI_GATEWAY_API_KEY`.

- [ ] Add the enums/models, indexes, JSON fields, cascade relation, and immutable-result columns from the design.
- [ ] Create matching PostgreSQL migration SQL.
- [ ] Add Zod server validation requiring `AI_GATEWAY_MODEL` outside skipped validation and allowing optional `AI_GATEWAY_API_KEY`.
- [ ] Run Prisma format, validate, and generate; confirm success.
- [ ] Commit `feat: add opportunity analysis persistence model`.

### Task 2: Minimized evidence and structured output validation

**Files:**
- Create: `apps/app/app/lib/opportunity/types.ts`
- Create: `apps/app/app/lib/opportunity/schema.ts`
- Create: `apps/app/app/lib/opportunity/input.ts`
- Create: `apps/app/app/lib/opportunity/input.test.ts`
- Create: `apps/app/app/lib/opportunity/schema.test.ts`

**Interfaces:**
- Produces `buildOpportunityInput({ prospectName, requestedUrl, audit, checks })`.
- Produces `opportunityOutputSchema` plus `validateOpportunityOutput(output, validCheckKeys)`.

- [ ] Write failing tests proving only hostname/business/audit/check evidence survives and private/contact/query/ID data cannot appear.
- [ ] Implement bounded primitive evidence serialization and minimized input.
- [ ] Write failing schema tests for integer score ranges, exact five categories, text/count/enum limits, duplicate titles, duplicate keys, and unknown evidence references.
- [ ] Implement Zod structural validation plus source-key validation.
- [ ] Run focused tests and commit `feat: validate opportunity analysis contracts`.

### Task 3: Versioned Gateway generation

**Files:**
- Modify: `apps/app/package.json`
- Modify: `bun.lock`
- Create: `apps/app/app/lib/opportunity/prompt.ts`
- Create: `apps/app/app/lib/opportunity/generate.ts`
- Create: `apps/app/app/lib/opportunity/generate.test.ts`

**Interfaces:**
- Produces `OPPORTUNITY_PROMPT_VERSION = "opportunity-v1"`.
- Produces `generateOpportunity(input, { model, generate? })` returning validated output, duration, and token usage.

- [ ] Read installed/current official AI SDK interfaces and add only required packages.
- [ ] Write a failing injected-generator test asserting prompt rubric, minimized payload, model ID, structured schema, and timeout signal/options.
- [ ] Implement Gateway structured generation without application retries.
- [ ] Write failing tests mapping timeout/rate-limit/provider/invalid-output cases to typed safe errors.
- [ ] Implement typed failure mapping and rerun focused tests.
- [ ] Commit `feat: generate structured opportunity analysis`.

### Task 4: Owner-scoped analysis Server Action

**Files:**
- Create: `apps/app/app/actions/opportunities.ts`
- Create: `apps/app/app/actions/opportunities.test.ts`

**Interfaces:**
- Produces `analyzeAuditOpportunity(auditId: string)` and redirects stored attempts to `/opportunities/[id]`.

- [ ] Write failing tests for signed-out/non-allowlisted users and missing, other-owner, failed, or incomplete audits; assert no generation.
- [ ] Implement owner-scoped authorization and completed-audit loading.
- [ ] Write failing tests for configuration checks and five-minute duplicate-running suppression.
- [ ] Implement attempt creation using current model/prompt version.
- [ ] Write failing success test asserting minimized generation, atomic recommendation creation/completed update, logging, revalidation, and redirect.
- [ ] Implement success persistence.
- [ ] Write failing tests for model/validation/persistence failures, safe failed state, and absence of partial/fallback scores.
- [ ] Implement failure persistence and run focused tests.
- [ ] Commit `feat: persist owner-scoped opportunity analyses`.

### Task 5: Owner-scoped analysis queries

**Files:**
- Create: `apps/app/app/(authenticated)/opportunities/queries.ts`
- Create: `apps/app/app/(authenticated)/opportunities/queries.test.ts`

**Interfaces:**
- Produces `parseOpportunityListParams`, `getOpportunities`, `getOpportunityDetail`, and `getLatestAuditOpportunity`.
- History uses 25 rows and `createdAt desc`, `id desc`.

- [ ] Write failing tests for page/status parsing, pagination, owner predicates, detail hiding, and latest-by-audit lookup.
- [ ] Implement focused query functions and run tests.
- [ ] Commit `feat: add owner-scoped opportunity queries`.

### Task 6: Opportunity UI

**Files:**
- Modify: `apps/app/app/(authenticated)/layout.tsx`
- Modify: `apps/app/app/(authenticated)/audits/[id]/page.tsx`
- Create: `apps/app/app/(authenticated)/opportunities/page.tsx`
- Create: `apps/app/app/(authenticated)/opportunities/[id]/page.tsx`
- Create: `apps/app/app/(authenticated)/opportunities/analyze-button.tsx`

**Interfaces:**
- Adds functional Opportunities navigation, audit analysis panel, history, completed results, failed state, and rerun action.

- [ ] Build the pending/error Analyze button and completed-audit analysis panel with paid-call disclosure.
- [ ] Build owner-scoped 25-row history with status filtering and safe failed/running rows.
- [ ] Build detail page with overall rubric, five category scores, summary/rationale, recommendations, linked check evidence, metadata, disclosure, and rerun.
- [ ] Ensure failed analyses show no score or partial result.
- [ ] Run lint and production build; commit `feat: build AI opportunity scoring interface`.

### Task 7: Migration, documentation, verification, and handoff

**Files:**
- Create: `docs/architecture/0004-m3-ai-opportunity-scoring.md`
- Modify: `README.md`

**Interfaces:**
- Documents model configuration, local Gateway credentials, Vercel OIDC/credential alternative, limits, and acceptance flow.

- [ ] Apply the additive M3 migration to the configured test database.
- [ ] Add ADR 0004 and README setup/acceptance/non-goals.
- [ ] Run fresh `bun run check`, `bun run test`, and `SKIP_ENV_VALIDATION=true bun run build`.
- [ ] Start a clean dev server and verify unauthorized routing plus local pages without spending tokens.
- [ ] With operator credentials available, manually analyze one completed audit; otherwise document this external-credential acceptance item as pending.
- [ ] Confirm clean worktree, commit `docs: document M3 AI opportunity scoring`, and present branch integration options.

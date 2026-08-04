# LeadForge M2 Website Audit Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe, synchronous, owner-scoped website audits with deterministic evidence, immutable history, and no new external infrastructure.

**Architecture:** A framework-independent `@repo/audit-engine` package validates and crawls public same-origin websites through injected DNS/fetch dependencies. The existing Next.js app authenticates, persists audit runs and findings through Prisma, and renders prospect, history, and result interfaces.

**Tech Stack:** Bun workspaces, TypeScript, Vitest, Next.js 16 App Router, Clerk, Prisma 7 with PostgreSQL adapter, Zod, native fetch, parse5 7, structured console logging.

## Global Constraints

- Keep one deployment rooted at `apps/app`; do not add an API app, queue, webhook, worker, storage service, or new account requirement.
- Crawl at most five same-origin HTML pages, follow at most five redirects per request, validate DNS and each redirect hop, and use concurrency no greater than two.
- Use five-second per-request and twenty-second whole-run deadlines and cap each response at two megabytes.
- Store immutable runs and deterministic `PASS | WARNING | FAIL` findings; do not add overall scores, AI recommendations, screenshots, or Lighthouse claims.
- Derive ownership exclusively from Clerk `auth().userId`; ignore any submitted owner identity.
- Never log fetched HTML, contact data, query strings, credentials, raw form submissions, or database URLs.
- Tests use injected network/DNS fixtures and never contact live websites.

---

### Task 1: Audit persistence model

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260804210000_m2_website_audits/migration.sql`

**Interfaces:**
- Produces Prisma enums `WebsiteAuditStatus`, `AuditCheckStatus`, `AuditCheckCategory` and models `WebsiteAudit`, `AuditCheck` exactly as specified in the M2 design.
- Later actions use `database.websiteAudit` and `database.auditCheck` delegates.

- [ ] Add a schema fixture assertion or Prisma validation command that fails before the models exist.
- [ ] Add the three enums, two models, cascade relation, unique audit/key constraint, and owner/history indexes from the design.
- [ ] Create SQL for matching PostgreSQL enums, tables, foreign key, unique constraint, and indexes.
- [ ] Run `cd packages/database && bunx prisma format && bunx prisma validate && bunx prisma generate` and confirm success.
- [ ] Commit with `git commit -m "feat: add website audit persistence model"`.

### Task 2: Audit engine package and public-target policy

**Files:**
- Create: `packages/audit-engine/package.json`
- Create: `packages/audit-engine/tsconfig.json`
- Create: `packages/audit-engine/index.ts`
- Create: `packages/audit-engine/types.ts`
- Create: `packages/audit-engine/errors.ts`
- Create: `packages/audit-engine/target-policy.ts`
- Create: `packages/audit-engine/target-policy.test.ts`
- Modify: `bun.lock`

**Interfaces:**
- Produces `AuditFailureCode`, `AuditEngineError`, `AuditDependencies`, `AuditEngineResult`, `AuditFinding`, and `validatePublicTarget(url, dependencies)`.
- `AuditDependencies` contains injectable `fetch`, `resolveHostname`, and `now` functions.

- [ ] Write failing table tests for unsupported protocols, embedded credentials, localhost aliases, IPv4/IPv6 loopback/private/link-local/reserved addresses, unsafe DNS results, and allowed public HTTP(S) targets.
- [ ] Configure `@repo/audit-engine` with `parse5`, `test`, `build`, and TypeScript workspace scripts so Turbo includes it automatically.
- [ ] Run `bun test packages/audit-engine/target-policy.test.ts`; expect missing-module/function failures.
- [ ] Implement typed failures and URL/DNS validation, rejecting when any resolved address is non-public.
- [ ] Run the target-policy tests; expect all cases to pass.
- [ ] Add redirect-policy tests proving every `Location` is resolved against the current URL and revalidated before follow-up.
- [ ] Implement and export the redirect validation helper; rerun the focused tests.
- [ ] Commit with `git commit -m "feat: enforce public audit target policy"`.

### Task 3: Bounded crawler

**Files:**
- Create: `packages/audit-engine/fetch-page.ts`
- Create: `packages/audit-engine/robots.ts`
- Create: `packages/audit-engine/crawler.ts`
- Create: `packages/audit-engine/crawler.test.ts`
- Modify: `packages/audit-engine/types.ts`
- Modify: `packages/audit-engine/index.ts`

**Interfaces:**
- Produces `crawlWebsite(url, dependencies): Promise<CrawlResult>`.
- `CrawlResult` includes requested/final URL, redirect count, attempted-page count, parsed pages, robots outcome, broken-link sample, and timing evidence.
- Parsed pages contain only extracted metadata/counts/links required by checks, not retained raw HTML.

- [ ] Write failing fixture tests for manual redirects, unsafe redirect rejection, per-response byte caps, non-HTML skipping, and typed timeout/unreachable failures.
- [ ] Implement `fetchPage` with an AbortController deadline, manual redirects, two-megabyte streaming cap, and content-type enforcement.
- [ ] Run focused tests and make them pass without live network access.
- [ ] Write failing robots tests for `LeadForgeAudit`, wildcard fallback, explicit homepage disallow, unavailable robots, and path exclusion.
- [ ] Implement the minimal robots parser/evaluator and stable `ROBOTS_BLOCKED` behavior.
- [ ] Write failing crawler tests for homepage-first order, preferred contact/about/services/pricing/legal discovery, same-origin enforcement, login/non-HTTP exclusion, five-page maximum, and twenty-link broken-link sample.
- [ ] Implement sequential bounded crawling, extracted page facts, and HEAD-with-GET-fallback link checks.
- [ ] Run `bun test packages/audit-engine`; confirm the crawler suite passes.
- [ ] Commit with `git commit -m "feat: add bounded website crawler"`.

### Task 4: Deterministic finding evaluator

**Files:**
- Create: `packages/audit-engine/checks/accessibility.ts`
- Create: `packages/audit-engine/checks/trust.ts`
- Create: `packages/audit-engine/checks/seo.ts`
- Create: `packages/audit-engine/checks/technical.ts`
- Create: `packages/audit-engine/checks/performance.ts`
- Create: `packages/audit-engine/checks/index.ts`
- Create: `packages/audit-engine/checks/checks.test.ts`
- Create: `packages/audit-engine/run-audit.ts`
- Modify: `packages/audit-engine/index.ts`

**Interfaces:**
- Produces `evaluateChecks(crawl: CrawlResult): AuditFinding[]` with one stable key per documented check.
- Produces `runWebsiteAudit(url, dependencies?): Promise<AuditEngineResult>`.

- [ ] Write failing fixture tests for every documented threshold and aggregation rule, asserting stable key/category/status/summary/evidence shape.
- [ ] Implement accessibility and trust evaluators; run only their focused cases until green.
- [ ] Implement SEO and technical evaluators; run their focused cases until green.
- [ ] Implement performance-indicator evaluators using homepage evidence and the exact spec thresholds; run their cases until green.
- [ ] Write a failing orchestration test proving `runWebsiteAudit` returns URLs, coverage, duration, and all unique findings.
- [ ] Implement orchestration and export the public package API.
- [ ] Run `bun test packages/audit-engine`; confirm all engine tests pass.
- [ ] Commit with `git commit -m "feat: evaluate deterministic website checks"`.

### Task 5: Owner-scoped audit Server Action

**Files:**
- Modify: `apps/app/package.json`
- Create: `apps/app/app/actions/audits.ts`
- Create: `apps/app/app/actions/audits.test.ts`

**Interfaces:**
- Produces `runProspectAudit(prospectId: string): Promise<{ status: "error"; message: string } | never>` and redirects completed/failed stored runs to `/audits/[id]`.
- Consumes `runWebsiteAudit`, `AuditEngineError`, Clerk auth/allowlist, Prisma delegates, logger, and Next revalidation/redirect.

- [ ] Write failing tests for signed-out and non-allowlisted callers, other-owner/missing prospects, and prospects without websites; assert no engine or audit write occurs.
- [ ] Implement authorization and owner-scoped prospect lookup, ignoring any submitted user identity.
- [ ] Write failing tests for suppression of a `RUNNING` audit newer than five minutes and allowance of stale runs.
- [ ] Implement recent-run lookup and redirect to the existing audit.
- [ ] Write failing success tests asserting `RUNNING` creation, engine call, transactional check creation, `COMPLETED` update, safe logging, revalidation, and redirect.
- [ ] Implement the successful action path.
- [ ] Write failing failure tests for typed engine errors, unknown engine errors, completion-persistence errors, and failure-update errors; assert safe user messages and no sensitive logging fields.
- [ ] Implement stable failure mapping and best-effort failed-run persistence.
- [ ] Run `bun test apps/app/app/actions/audits.test.ts`; confirm all action cases pass.
- [ ] Commit with `git commit -m "feat: persist owner-scoped audit runs"`.

### Task 6: Owner-scoped audit queries

**Files:**
- Create: `apps/app/app/(authenticated)/audits/queries.ts`
- Create: `apps/app/app/(authenticated)/audits/queries.test.ts`

**Interfaces:**
- Produces `parseAuditListParams`, `getAudits({ userId, status, page })`, `getAuditDetail({ userId, auditId })`, and `getLatestProspectAudit({ userId, prospectId })`.
- Audit history page size is 25 and ordering is `createdAt desc`, `id desc`.

- [ ] Write failing tests for page normalization, All/Completed/Failed parsing, fixed pagination, newest-first ordering, and owner predicates.
- [ ] Implement list parsing/query construction and run focused tests.
- [ ] Write failing tests proving detail and latest queries combine authenticated `userId` with audit/prospect IDs and include only required prospect/check data.
- [ ] Implement detail/latest queries and run focused tests.
- [ ] Commit with `git commit -m "feat: add owner-scoped audit queries"`.

### Task 7: Audit UI and navigation

**Files:**
- Modify: `apps/app/app/(authenticated)/layout.tsx`
- Modify: `apps/app/app/(authenticated)/prospects/[id]/page.tsx`
- Create: `apps/app/app/(authenticated)/audits/page.tsx`
- Create: `apps/app/app/(authenticated)/audits/[id]/page.tsx`
- Create: `apps/app/app/(authenticated)/audits/list-controls.tsx`
- Create: `apps/app/app/(authenticated)/audits/pagination.tsx`
- Create: `apps/app/app/(authenticated)/audits/run-audit-button.tsx`
- Create: `apps/app/app/(authenticated)/audits/check-group.tsx`

**Interfaces:**
- Consumes the Task 5 action and Task 6 queries.
- Produces functional `/audits`, `/audits/[id]`, and prospect audit-panel experiences with no placeholder navigation.

- [ ] Add Audits navigation and a prospect Website Audit card with latest state, result link, missing-website edit link, and pending Run/Run again action.
- [ ] Build the 25-row audit history page with All/Completed/Failed URL filters, domain/status/coverage/duration/date columns, pagination, and first-use/filtered empty states.
- [ ] Build the owner-scoped result page; return `notFound()` for missing/other-owner records.
- [ ] Render completed checks grouped in category order and sorted FAIL, WARNING, PASS; render evidence through an explicit key/value formatter rather than raw JSON.
- [ ] Render failed runs with only safe stored failure copy and a rerun action.
- [ ] Run `bun run check` and correct all formatting/accessibility findings.
- [ ] Run `bun run build` with `SKIP_ENV_VALIDATION=true`; confirm route and TypeScript compilation.
- [ ] Commit with `git commit -m "feat: build website audit interface"`.

### Task 8: Migration, documentation, and full verification

**Files:**
- Create: `docs/architecture/0003-m2-website-audit-foundation.md`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-08-04-m2-website-audit-foundation.md`

**Interfaces:**
- Documents architecture, limitations, commands, and the manual acceptance flow.

- [ ] Write ADR 0003 covering the isolated engine package, synchronous bounded execution, SSRF defenses, immutable evidence, and deferred queue/browser/storage choices.
- [ ] Update README with Audits routes, M2 acceptance flow, synchronous runtime limits, and no-new-environment-variable statement.
- [ ] Run `bun run migrate:deploy` against the configured test database and confirm both M2 tables/indexes are current.
- [ ] Run fresh `bun run check`, `bun run test`, and `SKIP_ENV_VALIDATION=true bun run build`; record exact pass counts and exit codes.
- [ ] Start `bun dev --filter app` from a clean process and smoke-test: run an owned public audit, inspect grouped results, refresh, see history, rerun, and verify a blocked target fails safely.
- [ ] Confirm `git diff --check` and `git status --short` are clean after committing documentation.
- [ ] Commit with `git commit -m "docs: document M2 website audit foundation"`.
- [ ] Push `codex/m2-website-audit-foundation` and open a pull request without merging it automatically.

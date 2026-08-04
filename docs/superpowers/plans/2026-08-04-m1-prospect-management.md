# LeadForge M1 Prospect Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure manual prospect CRUD, search, status filtering, pagination, archiving, and restoration to the existing single-owner LeadForge application.

**Architecture:** Extend the existing server-first Next.js app and Prisma package. Server Components query prospects, Server Actions perform mutations, and shared validation normalizes inputs. Every query and mutation derives the owner from Clerk and scopes by `userId`; URL parameters hold list search/filter/page state.

**Tech Stack:** Bun, Turborepo, Next.js App Router, Clerk, Prisma/PostgreSQL, Zod, shadcn/ui, Vitest, GitHub Actions, Vercel.

## Global Constraints

- Follow `docs/superpowers/specs/2026-08-04-m1-prospect-management-design.md`.
- Do not add permanent deletion, CSV, discovery providers, audits, AI, QStash, storage, outreach, tasks, deals, analytics, placeholder pages, webhooks, or backend services.
- Derive owner ID only from `auth().userId`; ignore browser-supplied owner IDs.
- Repeat allowlist enforcement in every mutation.
- Use archive/restore status transitions; never delete prospects.
- Test LeadForge-owned orchestration and security behavior, not dependency internals.

---

### Task 1: Prospect Schema, Migration, and Validation

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/<timestamp>_m1_prospects/migration.sql`
- Create: `packages/validation/prospect.ts`
- Modify: `packages/validation/index.ts`

**Interfaces:**
- Produces `ProspectStatus`, `Prospect`, `prospectSchema`, `ProspectInput`, and normalized nullable optional fields.

- [ ] Add the enum/model and indexes exactly as approved in the design.
- [ ] Implement `prospectSchema` with the approved limits, email normalization, and `http`/`https` URL normalization.
- [ ] Generate and inspect the migration, then apply it to the configured development database.
- [ ] Run Prisma format/generate, check, tests, and build; commit `feat: add prospect data model`.

---

### Task 2: Owner-Scoped Prospect Query Service

**Files:**
- Create: `apps/app/app/(authenticated)/prospects/queries.ts`
- Test: `apps/app/app/(authenticated)/prospects/queries.test.ts`

**Interfaces:**
- Produces `parseProspectListParams(searchParams)` and `getProspects({ userId, search, status, page })`.
- Returns `{ prospects, total, pageCount }`; page size is always 25.

- [ ] Write failing tests for default Active status, explicit statuses, case-insensitive OR search, owner scoping, newest-first stable sorting, and page bounds.
- [ ] Run the focused suite and confirm failures are caused by missing behavior.
- [ ] Implement the smallest query builder/service that passes the tests.
- [ ] Re-run focused and full tests; commit `feat: add prospect list queries`.

---

### Task 3: Prospect Mutation Actions

**Files:**
- Create: `apps/app/app/actions/prospects.ts`
- Test: `apps/app/app/actions/prospects.test.ts`

**Interfaces:**
- Produces `createProspect`, `updateProspect`, `archiveProspect`, and `restoreProspect` with the state/result shapes in the design.

- [ ] Write failing tests proving signed-out/non-owner denial, authenticated ownership, submitted `userId` ignoring, validation/normalization, cross-owner mutation protection, archive/restore status transitions, revalidation, and safe database-error handling.
- [ ] Run the focused suite and confirm RED.
- [ ] Implement minimal actions using compound `id` + `userId` predicates and structured logging without contact data.
- [ ] Re-run focused and full tests; commit `feat: add owner scoped prospect actions`.

---

### Task 4: Prospect List, Form, Detail, and Navigation

**Files:**
- Create: `apps/app/app/(authenticated)/prospects/page.tsx`
- Create: `apps/app/app/(authenticated)/prospects/new/page.tsx`
- Create: `apps/app/app/(authenticated)/prospects/[id]/page.tsx`
- Create: `apps/app/app/(authenticated)/prospects/prospect-form.tsx`
- Create: `apps/app/app/(authenticated)/prospects/list-controls.tsx`
- Create: `apps/app/app/(authenticated)/prospects/pagination.tsx`
- Modify: `apps/app/app/(authenticated)/layout.tsx`

**Interfaces:**
- Consumes query/action interfaces from Tasks 2-3.
- Produces URL-driven list and shared create/edit form.

- [ ] Add Prospects navigation only.
- [ ] Build the list with search, status filter, table, empty states, and pagination links preserving query state.
- [ ] Build the shared client form with field errors and pending/general status.
- [ ] Build create and owner-scoped detail pages; use `notFound()` for missing/cross-owner records.
- [ ] Add archive/restore controls and verify refresh persistence locally.
- [ ] Run tests, check, build, and an authenticated browser smoke test; commit `feat: add prospect management interface`.

---

### Task 5: Documentation, Release Verification, and Deployment

**Files:**
- Modify: `README.md`, `docs/architecture/0001-m0-foundation.md` only if current statements need milestone clarification
- Create: `docs/architecture/0002-m1-prospect-management.md`

**Interfaces:**
- Produces M1 operator/migration instructions and acceptance record.

- [ ] Document the owner-scoped CRUD design, migration commands, routes, and M1 non-goals.
- [ ] Run `bun install --frozen-lockfile`, `bun run check`, `bun run test`, and `bun run build` with the supported Node runtime.
- [ ] Apply the migration to the hosted test database and run the complete local acceptance flow.
- [ ] Push the branch, require green GitHub CI, deploy through the existing Vercel project, and run the production acceptance flow.
- [ ] Commit `docs: document M1 prospect management` and publish the final acceptance results.

## Acceptance Matrix

| Requirement | Evidence |
|---|---|
| Owner-scoped create/update | Action tests and local CRUD flow |
| Cross-owner isolation | Query/action tests |
| Validation/normalization | Action boundary tests |
| Search/status/page behavior | Query tests and list smoke test |
| Archive/restore | Action tests and refresh flow |
| No scope creep | Route/navigation/import scan |
| Release quality | Check, tests, build, CI, migration, production smoke |

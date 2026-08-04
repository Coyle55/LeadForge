# LeadForge M0 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a private, single-user LeadForge dashboard in one Next.js application where an allowlisted Clerk owner is synchronized into Neon on demand and can update their own display name.

**Architecture:** A trimmed next-forge Bun monorepo retains one deployable application and seven shared packages. Clerk authenticates requests; authorization compares `auth().userId` against `ALLOWED_USER_IDS`; `ensureCurrentUser()` resolves the authenticated Clerk account and upserts its primary email into the local Prisma `User` row before pages read it. No webhook, callback service, or external observability service is required for M0.

**Tech Stack:** Bun workspaces, Turborepo, Next.js App Router, React, Clerk, Prisma, `@prisma/adapter-pg`, Neon Postgres, Zod, shadcn/ui, Ultracite/Biome, Vitest, GitHub Actions, Vercel.

## Global Constraints

- Retain only `apps/app`, `packages/auth`, `packages/database`, `packages/design-system`, `packages/observability`, `packages/validation`, `packages/next-config`, and `packages/typescript-config`.
- Use `ALLOWED_USER_IDS`, containing comma-separated Clerk user IDs. Missing or empty configuration denies every authenticated user.
- Derive authorization and database ownership exclusively from `auth().userId`; never trust a user ID supplied by the browser or `FormData`.
- Application use must not depend on webhook delivery. M0 contains no webhook, `apps/api`, `apps/studio`, or separate backend service.
- The Prisma `User` model contains only `id`, `email`, `displayName`, `createdAt`, and `updatedAt`.
- Use `@prisma/adapter-pg` as `new PrismaPg({ connectionString })`; do not use `@prisma/adapter-neon`.
- Use a root `db:studio` script for Prisma Studio.
- Observability is a small structured console logger exposing stable `info` and `error` methods. Do not retain Better Stack, Logtail, or Sentry.
- Deploy only `apps/app` as one Vercel project.
- External Clerk, Neon, and Vercel account operations are documented, not performed without credentials and explicit access.
- Do not implement prospecting, audits, AI, QStash, storage, outreach, tasks, deals, analytics, placeholder navigation, webhooks, or separate backend services.
- Preserve existing repository metadata where it does not pull removed next-forge features back into the workspace.

## Planned File Map

- `package.json`, `bun.lock`, `turbo.json`, `biome.jsonc`: Bun workspace and root commands, including `db:studio`.
- `apps/app/proxy.ts`: Clerk authentication boundary and public-route matcher.
- `apps/app/app/(authenticated)/layout.tsx`: owner-ID allowlist boundary.
- `apps/app/app/(authenticated)/page.tsx`: Dashboard using `ensureCurrentUser()`.
- `apps/app/app/(authenticated)/settings/page.tsx`: Settings using `ensureCurrentUser()`.
- `apps/app/app/actions/settings.ts`: authenticated and owner-scoped display-name update.
- `packages/auth/allowlist.ts`: pure owner-ID allowlist parsing and membership.
- `packages/auth/ensure-current-user.ts`: Clerk-to-Prisma on-demand synchronization.
- `packages/database/prisma/schema.prisma`: minimal M0 `User` model.
- `packages/database/index.ts`: server-only Prisma client using `PrismaPg`.
- `packages/validation/settings.ts`: display-name input contract.
- `packages/observability/index.ts`: structured console logger.
- `.github/workflows/ci.yml`: install, check, test, and build.
- `docs/architecture/0001-m0-foundation.md`, `README.md`: decisions and exact external setup instructions.

---

### Task 1: Scaffold and Reduce to the M0 Workspace

**Files:**
- Create/replace: next-forge scaffold at repository root
- Modify: `package.json`, `turbo.json`, `biome.jsonc`, `.gitignore`, `.github/dependabot.yml`
- Retain: `apps/app` and the seven packages in Global Constraints
- Delete: every other scaffolded app and package, including `apps/api` and `apps/studio`

**Interfaces:**
- Produces: a Bun workspace with root scripts `dev`, `build`, `check`, `fix`, `test`, `migrate`, `migrate:deploy`, and `db:studio`.

- [ ] Record the pre-scaffold files and tool versions; scaffold `next-forge@latest` into a temporary directory with project name `leadforge` and Bun; merge without copying its `.git` directory.
- [ ] Delete every app except `apps/app` and every package except the seven retained packages. Remove deleted workspace imports, providers, environment declarations, and Turbo references.
- [ ] Set the root package name to `leadforge`, keep the generated Bun version pin, add `db:studio` using the current Prisma config, and ensure `turbo.json` uses `tasks`.
- [ ] Run dependency/import scans for removed features, `bun install`, `bun run check`, and `SKIP_ENV_VALIDATION=true bun run build`. Commit `chore: scaffold leadforge m0 workspace`.

---

### Task 2: Minimal Database and Validation Foundation

**Files:**
- Create/modify: `packages/database/prisma/schema.prisma`, `packages/database/prisma.config.ts`, `packages/database/index.ts`, `packages/database/keys.ts`, `packages/database/.env.example`
- Create: `packages/database/prisma/migrations/<timestamp>_m0_user/migration.sql`
- Create/modify: `packages/validation/settings.ts`, `packages/validation/index.ts`
- Test: behavior through `apps/app/app/actions/settings.test.ts` in Task 4; do not add tests for Prisma or Zod internals

**Interfaces:**
- Produces: `database.user` and `settingsSchema` for `{ displayName: string }`, trimmed, 1-80 characters.

- [ ] Replace the scaffold schema with only `User { id String @id, email String @unique, displayName String?, createdAt DateTime @default(now()), updatedAt DateTime @updatedAt }`.
- [ ] Configure `DATABASE_URL`, `PrismaPg({ connectionString })`, a development singleton, server-only import protection, and the current Prisma config.
- [ ] Implement `settingsSchema`; its behavior is exercised at the server-action boundary rather than with a test that merely repeats Zod behavior.
- [ ] Generate and inspect an initial migration against an available development PostgreSQL database. If no database credentials exist, check in reviewed deterministic SQL for the five-column table and document the exact migration command to validate/apply later.
- [ ] Run Prisma formatting/generation, `bun run check`, and the build. Commit `feat: add minimal m0 user database`.

---

### Task 3: Owner Authorization and On-Demand User Synchronization

**Files:**
- Create/modify: `packages/auth/allowlist.ts`, `packages/auth/allowlist.test.ts`, `packages/auth/ensure-current-user.ts`, `packages/auth/ensure-current-user.test.ts`, `packages/auth/proxy.ts`, `packages/auth/index.ts`
- Create/modify: `apps/app/proxy.ts`, `apps/app/app/(authenticated)/layout.tsx`, `apps/app/app/access-denied/page.tsx`, `apps/app/.env.example`

**Interfaces:**
- Produces: `isAllowedUserId(userId: string, configuredIds?: string): boolean` and `ensureCurrentUser(): Promise<User>`.
- `ensureCurrentUser()` derives `userId` only from `auth()`, rejects signed-out callers, resolves the Clerk user server-side, selects the primary email, upserts `{ id: userId, email }`, updates changed email while preserving `displayName`, and returns the local row.

- [ ] Write failing owner-ID allowlist tests for exact membership, trimming, duplicate entries, substring rejection, and fail-closed empty configuration. Run them and confirm the expected RED failure.
- [ ] Implement the minimal allowlist helper and re-run the focused suite to GREEN.
- [ ] Write failing `ensureCurrentUser()` tests proving signed-out rejection without Clerk/database calls, owner ID derivation from `auth()`, primary-email selection, create/update upsert behavior, changed-email synchronization, returned local user, missing-primary-email safety, and safe database-error logging.
- [ ] Implement `ensureCurrentUser()` with dependency calls isolated enough for Vitest mocks, no webhook assumptions, and no mutation of `displayName`. Re-run the focused suite to GREEN.
- [ ] Configure `apps/app/proxy.ts` to redirect unauthenticated protected requests. In the authenticated layout, compare `auth().userId` directly with `ALLOWED_USER_IDS`; redirect non-owners to `/access-denied`; call no Clerk profile API for the allowlist check.
- [ ] Add `ALLOWED_USER_IDS` and required Clerk/database values to `.env.example`; verify focused tests, all tests, check, and build. Commit `feat: authorize owner and ensure local user`.

---

### Task 4: Dashboard, Settings, and Scoped Server Action

**Files:**
- Create/modify: `apps/app/app/(authenticated)/page.tsx`, `apps/app/app/(authenticated)/settings/page.tsx`, focused navigation components
- Create: `apps/app/app/actions/settings.ts`, `apps/app/app/actions/settings.test.ts`

**Interfaces:**
- Consumes: `ensureCurrentUser()`, `settingsSchema`, `database.user`, and the stable logger.
- Produces: `updateDisplayName(_previousState, formData): Promise<{ status: "success" | "error"; message: string }>`.

- [ ] Write failing action tests proving signed-out/unauthorized calls do not write, valid input uses only `auth().userId`, a submitted `userId` is ignored, invalid/empty/overlong input is rejected, and database errors return a safe message without leaking details.
- [ ] Implement the minimal server action: derive `userId` from `auth()`, enforce the same owner-ID allowlist, validate `displayName`, update `where: { id: userId }`, log structured success/error fields, and revalidate Dashboard and Settings.
- [ ] Build Dashboard and Settings with real data returned by `ensureCurrentUser()`. Dashboard shows email, display name, created time, and updated time; Settings edits only display name and persists across refresh.
- [ ] Trim branding, providers, and navigation to LeadForge, Dashboard, Settings, and Clerk account/sign-out affordances. Add no placeholder pages or fake metrics.
- [ ] Run focused tests, all tests, check, build, and a local authenticated smoke test when Clerk/Neon credentials are available. Commit `feat: add owner dashboard and settings`.

---

### Task 5: Console Logging, CI, Documentation, and Release Handoff

**Files:**
- Create/modify: `packages/observability/index.ts`
- Create: `.github/workflows/ci.yml`, `docs/architecture/0001-m0-foundation.md`, `README.md`

**Interfaces:**
- Produces: `logger.info(event, fields)` and `logger.error(event, fields)` writing structured JSON-safe records through the console.

- [ ] Implement the small logger without external transports. Do not test console-library behavior; verify safety through `ensureCurrentUser()` and server-action error-path tests.
- [ ] Add CI for push to `main` and pull requests: pinned Bun, frozen install, check, test, and build with non-secret build placeholders and no migration against a dummy URL.
- [ ] Write ADR 0001 covering next-forge trimming, one application, Clerk-ID allowlisting, on-demand synchronization, Clerk ID as database key, `adapter-pg`, console-only logging, and explicit M0 non-goals.
- [ ] Write exact, separate operator steps for creating/configuring Clerk, Neon, and one Vercel project rooted at `apps/app`; include environment placement, migration commands, local commands, CI, acceptance flow, and credential-dependent steps that remain for the user.
- [ ] Run `bun install --frozen-lockfile`, `bun run check`, `bun run test`, and `SKIP_ENV_VALIDATION=true bun run build`. Commit `chore: add m0 operations and ci`.

---

## Final M0 Acceptance Flow

1. An unauthenticated visitor is redirected to Clerk sign-in.
2. An authenticated Clerk user whose ID is absent from `ALLOWED_USER_IDS` is denied.
3. An allowlisted user reaches the application without waiting for a webhook.
4. `ensureCurrentUser()` creates or updates that user's local Prisma row and current primary email.
5. Dashboard displays real data from that row.
6. Settings updates only the authenticated owner's `displayName`.
7. The update persists after refresh.
8. `bun run check`, `bun run test`, and `bun run build` pass.
9. One Vercel deployment rooted at `apps/app` passes the same flow after the user supplies credentials and configures external accounts.

## Plan Self-Review Notes

- Removed `apps/api`, `apps/studio`, webhooks, external logging, Sentry, and the second Vercel deployment from every task and acceptance criterion.
- Tests focus on LeadForge-owned security and orchestration behavior, not the behavior of Zod, Prisma, Clerk, or console libraries.
- Implementation ends with documented external setup and a credential-dependent handoff; it does not claim external provisioning or production acceptance without access.

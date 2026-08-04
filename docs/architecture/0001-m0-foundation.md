# ADR 0001: LeadForge M0 Foundation

- Status: Accepted
- Date: 2026-08-04

## Context

M0 must prove private authentication, a user-scoped database write, and a deployable application. Prospecting and audit workflows are later milestones and do not justify callback infrastructure yet.

## Decision

LeadForge starts from next-forge but retains one Next.js app and only the shared auth, database, design-system, observability, validation, Next config, and TypeScript config packages. Aggressive trimming preserves proven monorepo conventions without carrying unused SaaS integrations.

Clerk owns authentication. `ALLOWED_USER_IDS` authorizes the owner by the immutable Clerk ID returned from `auth()`. `ensureCurrentUser()` resolves the current Clerk profile on the server and upserts the primary email into a five-field Prisma `User`. This makes the signed-in request path self-sufficient and avoids webhook ordering or delivery concerns.

The Clerk user ID is the local primary key, so all reads and writes can be scoped directly to authenticated identity. Prisma uses `@prisma/adapter-pg`, which works with local PostgreSQL and Neon. Prisma Studio is a root command, not an application.

M0 logging is structured JSON through a stable console-only `info`/`error` interface. One Vercel project deploys from `apps/app`.

## Consequences

- The owner can use the application immediately after an allowlisted sign-in.
- A Clerk profile lookup occurs when Dashboard or Settings ensures the local user; authorization itself does not require that lookup.
- Email changes synchronize on the next application visit.
- Account deletion is not synchronized in M0. A later asynchronous service may add lifecycle handling when QStash and website-audit callbacks justify it.
- Clerk, Neon, and Vercel provisioning remains an operator action requiring credentials.

## Non-goals

No prospecting, audits, AI, QStash, storage, outreach, tasks, deals, analytics, placeholder navigation, webhooks, or separate backend services are part of M0.

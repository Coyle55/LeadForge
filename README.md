# LeadForge

LeadForge is a private, single-owner lead workspace. M0 established Clerk authentication, a PostgreSQL-backed user profile, and a Clerk user-ID allowlist. M1 adds manual prospect creation, search, editing, archiving, and restoration without adding discovery providers or backend services.

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
- `/prospects` — searchable, status-filtered prospect list
- `/prospects/new` — create a prospect
- `/prospects/[id]` — edit, archive, or restore an owned prospect
- `/settings` — update the owner's display name

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
4. Deploy once the production migration has been applied.

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

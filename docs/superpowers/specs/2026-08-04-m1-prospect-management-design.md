# LeadForge M1 Prospect Management Design

## Goal

M1 adds manual, owner-scoped prospect management to the existing private LeadForge application. The owner can create, view, search, filter, edit, archive, and restore prospects. M1 does not discover prospects or integrate external providers.

## Scope

M1 includes:

- Manual prospect creation and editing
- Owner-scoped prospect list and detail views
- Search across business name, website, contact name, and contact email
- Status filtering
- Newest-first sorting
- Server-side pagination with 25 records per page
- Archive and restore operations
- Navigation, empty states, validation feedback, tests, CI, and production deployment

M1 excludes:

- Permanent deletion
- CSV import or export
- External business discovery
- Bulk actions
- Website audits, screenshots, scoring, recommendations, or AI
- Outreach, tasks, deals, pipeline, analytics, or placeholder pages
- Separate API services, webhooks, QStash, or storage

## Architecture

M1 follows a server-first App Router design. Server Components load prospect data, and Server Actions create, update, archive, and restore records. Search, status, page, and sort state are encoded in URL query parameters so list views are linkable and refresh-safe.

No client-side data-fetching layer or route-handler API is introduced. Client components are limited to form pending/error behavior and controls that need browser interaction.

Every operation derives the owner ID from Clerk `auth()`. Neither URLs nor form submissions are trusted to identify the owner. Database reads and mutations include both prospect ID and authenticated `userId` where applicable.

## Data Model

Add the following Prisma enum and model:

```prisma
enum ProspectStatus {
  NEW
  QUALIFIED
  ARCHIVED
}

model Prospect {
  id           String         @id @default(cuid())
  userId       String
  businessName String
  websiteUrl   String?
  contactName  String?
  contactEmail String?
  phone        String?
  location     String?
  notes        String?
  status       ProspectStatus @default(NEW)
  createdAt    DateTime       @default(now())
  updatedAt    DateTime       @updatedAt

  @@index([userId, status])
  @@index([userId, createdAt])
}
```

The existing Clerk user ID is stored in `userId`, but M1 does not add a Prisma relation to `User`; ownership queries remain direct and server-derived. Business names are intentionally not unique because distinct locations or duplicate leads may share a name.

## Validation

One shared prospect schema validates create and edit input:

- `businessName`: required after trimming, maximum 160 characters
- `websiteUrl`: optional; empty input becomes null; otherwise normalize to an absolute `http` or `https` URL and reject other protocols
- `contactName`: optional, maximum 160 characters
- `contactEmail`: optional; lowercase after trimming and validate as an email
- `phone`: optional, maximum 50 characters
- `location`: optional, maximum 240 characters
- `notes`: optional, maximum 5,000 characters
- `status`: not accepted from create/edit form submissions; archive and restore use dedicated actions

Validation failures return field-level messages. Unexpected persistence failures return a generic user-facing error and emit structured server logs without form contents or secrets.

## Routes and UI

### Navigation

Add `Prospects` beside Dashboard and Settings. Do not add navigation for later milestones.

### `/prospects`

The list page contains:

- Search input
- Status filter for Active, New, Qualified, and Archived
- Add prospect button
- Paginated table ordered by `createdAt desc`, with `id desc` as a stable tie-breaker

Each row displays business name, website hostname, contact name/email, location, status, and updated time. Clicking the primary row link opens the edit page.

The default Active filter includes `NEW` and `QUALIFIED` and excludes `ARCHIVED`. Empty states distinguish an empty database from a filtered query with no matches.

Search is case-insensitive and matches business name, website URL, contact name, or contact email. Page values below 1 or non-numeric values resolve to page 1. Page size is fixed at 25. If filtering reduces the result count below the current page, the page renders an empty filtered state with navigation back to page 1 rather than silently changing the URL.

### `/prospects/new`

Displays the shared form in create mode. Successful creation redirects to the new prospect's edit page and shows a success state through the redirected page.

### `/prospects/[id]`

Loads the prospect with `where: { id, userId }`. A missing or other-owner record returns `notFound()` so record existence is not disclosed.

The shared form edits business/contact fields. A separate button archives an active prospect or restores an archived prospect. Successful mutations revalidate the list and detail routes.

## Server Interfaces

The implementation exposes these focused operations:

```ts
type ProspectFormState = {
  status?: "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string[]>;
};

createProspect(previousState: ProspectFormState, formData: FormData): Promise<ProspectFormState>;
updateProspect(previousState: ProspectFormState, formData: FormData): Promise<ProspectFormState>;
archiveProspect(prospectId: string): Promise<ActionResult>;
restoreProspect(prospectId: string): Promise<ActionResult>;

getProspects(input: {
  userId: string;
  search?: string;
  status: "ACTIVE" | "NEW" | "QUALIFIED" | "ARCHIVED";
  page: number;
}): Promise<{ prospects: Prospect[]; total: number; pageCount: number }>;
```

`updateProspect` reads a prospect ID from trusted route-bound form state or a hidden field but always combines it with authenticated `userId` in the mutation predicate. Submitted `userId` values are ignored everywhere.

## Error Handling and Logging

- Signed-out actions return `Not authorized` without database access.
- Authenticated but non-allowlisted users are already blocked by the application layout; actions repeat the owner check as a defense-in-depth boundary.
- Invalid form input returns field errors without a database write.
- Cross-owner or missing records return the same safe not-found/action error.
- Database errors log event name, authenticated user ID, prospect ID when applicable, duration, and error object.
- Logs do not include notes, contact details, raw form data, database URLs, or Clerk secrets.

## Testing Strategy

Tests cover LeadForge-owned behavior rather than Prisma, Clerk, or Zod internals:

- Creation derives ownership from `auth().userId` and ignores submitted owner IDs.
- Signed-out and non-allowlisted callers cannot write.
- Update, archive, and restore combine prospect ID with authenticated owner ID.
- Cross-user records cannot be read or mutated.
- Input boundaries reject missing names, invalid protocols/emails, and excessive lengths.
- Optional empty fields normalize to null.
- List query construction scopes by owner and correctly applies Active/status/search filters.
- Pagination is bounded to page 1+ and fixed at 25.
- Database failures produce safe responses and structured logs.

## Acceptance Flow

1. The owner opens Prospects and sees the first-use empty state.
2. The owner creates a prospect with valid business and contact details.
3. The prospect appears first in the newest-first list.
4. Search and status filters find the expected record.
5. The owner edits the prospect, refreshes, and sees persisted values.
6. The owner archives the prospect; it disappears from Active.
7. The Archived filter shows the prospect.
8. Restore returns it to Active.
9. Automated tests prove other-owner access is rejected.
10. Check, tests, build, CI, migration deployment, and the production flow pass.

## Operational Changes

- Add and apply one Prisma migration for `ProspectStatus`, `Prospect`, and its indexes.
- No new environment variables or external accounts are required.
- Deploy through the existing GitHub-connected `leadforge-app` Vercel project after CI passes.

## Deferred Decisions

CSV import/export, deduplication, provider discovery, website audits, scoring, outreach, and bulk operations will be designed in their own milestones using the M1 prospect record as their input boundary.

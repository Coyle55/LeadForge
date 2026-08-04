# ADR 0002: Manual Prospect Management

- Status: Accepted
- Date: 2026-08-04

## Context

M1 must establish a trustworthy prospect record before discovery, audits, scoring, or outreach can depend on it. LeadForge remains a private, single-owner application, so a separate API, client-side data layer, and asynchronous infrastructure would add operational surface without validating this milestone.

## Decision

LeadForge adds an owner-scoped `Prospect` model with business, website, contact, location, notes, status, and timestamps. `NEW`, `QUALIFIED`, and `ARCHIVED` are the only statuses. Archive and restore are explicit state changes; M1 offers no hard delete.

Server Components read prospects and Server Actions mutate them. Search, filter, and page state live in URL query parameters. The default Active view includes New and Qualified records, excludes Archived records, sorts newest first, and uses a fixed page size of 25.

Every read and mutation derives the owner ID from Clerk `auth()`. Record identifiers from URLs or forms are always combined with that authenticated ID. Submitted owner IDs are ignored. Missing and other-owner records receive the same response.

One shared validation schema normalizes optional fields and validates application inputs. Unexpected database failures return generic messages and emit structured metadata without logging prospect contents or credentials.

## Consequences

- Prospect pages remain refresh-safe and linkable without a client data cache.
- Ownership is enforced at the query boundary and covered by focused tests.
- Archived records remain recoverable and auditable.
- Duplicate business names are allowed because separate locations or leads may share a name.
- The model can become the input boundary for later discovery and audit milestones without introducing those systems in M1.

## Non-goals

M1 does not include permanent deletion, CSV import/export, bulk actions, prospect discovery, audits, screenshots, scoring, AI, outreach, tasks, deals, analytics, webhooks, QStash, storage, or a separate backend service.

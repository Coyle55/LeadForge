# M4 Outreach Generation Design

Date: 2026-08-04  
Status: Approved for implementation planning

## Objective

M4 turns one owner-selected M3 recommendation into a concise, consultative cold-email draft. The owner can edit, save, copy, reset, and regenerate drafts, but LeadForge does not send email in this milestone.

Success means the generated message is grounded in stored audit evidence, uses explicit sender context, requires a known recipient, preserves its original generation, and remains fully owner-scoped.

## Scope

M4 includes:

- one reusable Outreach Profile per owner
- a required prospect contact name and contact email
- generation from one owner-selected recommendation in a completed M3 analysis
- a subject line and plain-text email body
- immutable generation history plus an editable working copy
- draft history, editing, copying, resetting, and regeneration
- structured operational logs and safe failure records

M4 excludes email delivery providers, sequences, follow-ups, HTML email, delivery/open tracking, contact discovery, bulk generation, autonomous outreach, QStash, webhooks, tasks, deals, analytics, and separate services.

## Architecture

M4 remains inside the single `apps/app` deployment. Server actions perform authorization, database access, and synchronous AI generation. The existing Vercel AI SDK and AI Gateway configuration are reused; no second AI infrastructure package is needed while `apps/app` remains the only consumer.

The design has four focused units:

1. Outreach Profile validation and persistence
2. Minimized, evidence-grounded prompt input construction
3. Strict structured generation and failure classification
4. Owner-scoped draft history and working-copy editing

## Data model

### OutreachProfile

One profile per owner:

- `id`
- `userId`, unique
- `senderName`
- `companyName`
- `serviceOffered`
- `valueProposition`
- `defaultCta`
- `createdAt`
- `updatedAt`

The profile is intentionally separate from `User`: it is product configuration, not authentication identity. All fields are required after trimming and have explicit validation bounds.

### OutreachDraft

Each generation attempt is a separate immutable history record:

- `id`
- `userId`
- `prospectId`
- `analysisId`
- `recommendationId`
- `status`: `RUNNING`, `COMPLETED`, or `FAILED`
- recipient snapshot: `recipientName`, `recipientEmail`
- source snapshot: `businessName`, `websiteHostname`, `recommendationTitle`
- immutable generated fields: `generatedSubject`, `generatedBody`
- editable working fields: `subject`, `body`
- generation metadata: `model`, `promptVersion`, `inputTokens`, `outputTokens`, `durationMs`
- failure metadata: `failureCode`, `failureMessage`
- `startedAt`, `completedAt`, `createdAt`, `updatedAt`

The generated fields are written only when generation completes and never updated afterward. Working fields initially equal generated fields and may be edited or reset. Regeneration always creates another `OutreachDraft`; it never overwrites history.

Relations and indexes support owner-scoped history by creation time, prospect history, and analysis history. Deleting a source record is not part of current product behavior, so M4 does not introduce cascade behavior that could erase draft history unexpectedly.

## Authorization boundary

Every action derives the Clerk user ID exclusively from `auth()` and confirms it is allowlisted. Browser input may identify only the requested source by opaque record ID.

Before generation, the server reloads and verifies:

- an owned prospect with both contact name and contact email
- an owned, completed opportunity analysis for that prospect
- a recommendation belonging to that analysis
- the owner's complete Outreach Profile

The server does not trust or accept browser-submitted owner IDs, recipient details, recommendation content, generated text, or sender profile values. Draft reads and updates include both draft ID and authenticated owner ID. Editing may update only `subject` and `body`; generated snapshot and linkage fields are never accepted from form data.

## Generation input

The model receives only:

- recipient first name and business name
- website hostname
- selected recommendation title, rationale, and suggested action
- the selected recommendation's referenced audit-check labels, statuses, summaries, and primitive evidence
- sender name and company name
- service offered, value proposition, and default CTA

It does not receive Clerk data, database IDs, recipient email, unrelated prospect notes, other recommendations, or unrelated audit evidence. Evidence values are limited to safe primitives and bounded strings using the same minimization principles established in M3.

## Output contract and prompt policy

The structured model response contains exactly:

- `subject`: a concise, non-spammy subject line
- `body`: a concise plain-text cold email

The prompt requires a consultative voice: one concrete observation, a carefully qualified business implication, a connection to the configured offer, and the configured low-pressure CTA. It prohibits:

- invented results, statistics, clients, credentials, or personal familiarity
- pretending the sender personally conducted work not supported by the input
- unsupported claims about revenue, rankings, conversions, penalties, or legal compliance
- fake urgency, manipulative pressure, or deceptive reply/thread language
- multiple unrelated audit issues
- HTML, markdown decoration, tracking links, or attachments

The output schema enforces trimmed length bounds, rejects control characters, and requires plain text. The subject and body must be non-empty and distinct from placeholder text.

## Generation lifecycle

1. The owner selects **Draft outreach** for one recommendation.
2. The action reauthorizes and reloads all source records.
3. Missing prospect contact data or Outreach Profile fields returns a precise correction path before any model call.
4. A recent `RUNNING` draft for the same owner and recommendation suppresses duplicate paid calls.
5. The action creates a `RUNNING` attempt with source snapshots and generation metadata.
6. The AI SDK sends one request through the configured Gateway model with a fixed timeout and no automatic paid retry.
7. Valid output atomically updates the attempt to `COMPLETED`, setting generated and working copies to identical content.
8. Invalid, timed-out, rate-limited, or gateway failures update the attempt to `FAILED` with a stable safe code/message and no subject or body.
9. The action redirects to the attempt detail page.

If the initial attempt record cannot be written, no model call occurs. If result persistence fails after a successful model response, the action reports a safe persistence error and logs identifiers only; it does not expose or fabricate content.

## User experience

### Settings

Settings adds an **Outreach Profile** section with fields for sender name, company name, service offered, value proposition, and default CTA. Save feedback distinguishes validation errors, authorization failures, and safe database failures.

### Opportunity detail

Each recommendation on a completed analysis has a **Draft outreach** action. LeadForge evaluates readiness before presentation:

- missing contact fields link to the prospect editor
- missing profile fields link to Settings
- ready recommendations can start generation

The action always repeats those checks server-side.

### Outreach history

`/outreach` lists owner-scoped completed or failed attempts newest first. Each row shows prospect, recipient, recommendation title, status, and creation time. It supports completed/failed filtering and pagination consistent with audit and opportunity history.

### Draft detail and editor

`/outreach/[id]` shows:

- recipient and prospect context
- source recommendation and links to its opportunity analysis and audit evidence
- editable subject and plain-text body
- Save, Copy subject, Copy body, and Reset to generated controls
- saved, unsaved, validation, and safe database-error states
- model, prompt version, duration, and creation metadata

Reset changes the working subject/body back to the immutable generated values and persists that reset. Regenerate returns to the source recommendation and creates a new attempt; it never mutates the current record. Failed records show failure context and a retry path but no editor or synthetic content.

## Error handling and observability

Expected generation classifications remain stable: model not configured, rate limited, timeout, invalid output, gateway error, and internal error. Database start/save failures are distinguished from model failures for operations without exposing database details.

Structured logs include owner ID, source record IDs, draft ID, model, prompt version, duration, token counts, status, and safe failure code. Logs exclude recipient name/email, sender profile content, subject/body, model prompt, and model response.

## Testing strategy

Tests focus on LeadForge behavior rather than underlying library behavior:

- owner scoping across profiles, prospects, analyses, recommendations, and drafts
- rejection of missing contact name/email and incomplete profile before generation
- ignoring browser-submitted owner, recipient, recommendation, generated-copy, and linkage values
- minimized model input and exact evidence-key grounding
- strict subject/body validation and plain-text bounds
- generated snapshot immutability while working subject/body are editable
- reset restoring the original generation
- regeneration producing a new draft record
- recent-running suppression of duplicate calls
- safe AI and database failure persistence with no fabricated output
- query filtering and pagination
- editor/copy/reset behavior only where UI tests protect application logic

Tests do not merely verify Zod, Prisma, Clerk, the AI SDK, or clipboard APIs.

## Acceptance flow

1. The owner completes and saves the Outreach Profile.
2. An owned prospect has both contact name and contact email.
3. The owner opens a completed M3 analysis and selects one recommendation.
4. LeadForge generates and persists a concise subject and plain-text email body grounded in that recommendation's evidence.
5. The owner edits and saves the working copy, refreshes, and sees it persist.
6. Reset restores and persists the immutable generated copy.
7. Regeneration creates a separate history item.
8. Failed attempts contain safe failure information and no synthetic email.
9. History and detail reads never disclose another owner's drafts.
10. Checks, tests, production build, migration deployment, and the single Vercel deployment pass.

## Deferred work

M4 does not send email or introduce delivery integrations. Multi-step sequences, follow-ups, HTML rendering, contact discovery, bulk generation, autonomous operation, delivery/open tracking, unsubscribe management, QStash, webhooks, tasks, deals, analytics, and additional services require their own milestone design and compliance review.

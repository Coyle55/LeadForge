# LeadForge M2 Website Audit Foundation Design

## Goal

M2 adds a bounded, deterministic website-audit engine to the existing private LeadForge application. The owner can run an audit for an owned prospect, inspect structured evidence, and revisit immutable audit history. M2 validates synchronous crawling and audit persistence without adding scoring, AI, screenshots, queues, storage services, or another deployment.

## Scope

M2 includes:

- User-triggered audits for prospects with a valid public website
- Same-origin crawling of no more than five HTML pages per run
- Respect for robots.txt exclusions
- Deterministic accessibility, trust, SEO, technical-health, and performance-indicator checks
- Immutable audit runs with grouped pass, warning, and fail results
- Owner-scoped audit history and result pages
- Safe target validation, redirect validation, timeouts, and response-size limits
- Structured console logging, focused tests, a Prisma migration, documentation, CI, and the existing single Vercel deployment

M2 excludes:

- Overall scoring or opportunity ranking
- AI-generated findings or recommendations
- Lighthouse or a managed browser runtime
- Screenshots or file/blob storage
- QStash, queues, retries, webhooks, or asynchronous workers
- A separate API or callback application
- Prospect discovery, CSV workflows, outreach, tasks, deals, pipeline, or analytics

## Architecture

Add `packages/audit-engine` as a framework-independent package. It accepts a public website URL plus injected network and DNS dependencies and returns a structured audit result. It has no Clerk, Prisma, Next.js, or React dependencies.

`apps/app` owns authentication, authorization, persistence, navigation, and presentation. A Server Action derives the current Clerk user ID from `auth()`, repeats the allowlist check, loads the prospect with both `id` and `userId`, creates an audit run, invokes the engine, and persists the outcome. Form data and route parameters never identify the owner.

Audits run synchronously inside the existing Next.js deployment. The engine uses a strict crawl and time budget so the implementation remains compatible with a single Vercel Function request. Its package boundary allows a later milestone to move execution behind QStash without changing the stored result contract or UI.

## Crawl Policy

The audit begins with the prospect's normalized website URL and follows these rules:

- Support only `http:` and `https:` URLs.
- Reject embedded credentials, localhost names, IP literals in private/link-local/loopback/reserved ranges, and hostnames that resolve to such addresses.
- Resolve and validate DNS before each outbound request.
- Disable automatic redirects. Validate each redirect target and its resolved addresses before following it.
- Follow at most five redirects for any request.
- Fetch robots.txt using the same target-safety policy. Apply rules for the `LeadForgeAudit` user agent, falling back to `*` rules. An unavailable or invalid robots.txt is treated as no declared restriction; an explicit disallow is honored.
- Crawl only same-origin pages after the final homepage redirect. External links may be counted as evidence but are never fetched.
- Audit the homepage plus at most four useful internal pages, preferring contact, about, services, pricing, and legal paths discovered in homepage links.
- Skip fragments, mailto, tel, javascript, authentication/login paths, and non-HTTP links.
- Fetch sequentially or with concurrency no greater than two.
- Use a five-second per-request timeout and a twenty-second whole-audit deadline.
- Read no more than two megabytes per response. Skip non-HTML page bodies.
- Use the `LeadForgeAudit/1.0` user agent.

An audit may complete with fewer than five pages. At least one successfully parsed HTML page is required for a completed result.

## Data Model

Add these Prisma enums and models:

```prisma
enum WebsiteAuditStatus {
  RUNNING
  COMPLETED
  FAILED
}

enum AuditCheckStatus {
  PASS
  WARNING
  FAIL
}

enum AuditCheckCategory {
  ACCESSIBILITY
  TRUST
  SEO
  TECHNICAL
  PERFORMANCE
}

model WebsiteAudit {
  id             String             @id @default(cuid())
  userId         String
  prospectId     String
  requestedUrl   String
  finalUrl       String?
  status         WebsiteAuditStatus @default(RUNNING)
  failureCode    String?
  failureMessage String?
  pagesAttempted Int                @default(0)
  pagesAudited   Int                @default(0)
  durationMs     Int?
  startedAt      DateTime           @default(now())
  completedAt    DateTime?
  createdAt      DateTime           @default(now())
  checks         AuditCheck[]

  @@index([userId, createdAt])
  @@index([userId, prospectId, createdAt])
}

model AuditCheck {
  id       String             @id @default(cuid())
  auditId  String
  category AuditCheckCategory
  key      String
  label    String
  status   AuditCheckStatus
  summary  String
  evidence Json
  audit    WebsiteAudit       @relation(fields: [auditId], references: [id], onDelete: Cascade)

  @@unique([auditId, key])
  @@index([auditId, category, status])
}
```

Audit runs are immutable after reaching `COMPLETED` or `FAILED`. A rerun creates a new `WebsiteAudit`. The direct `userId` and `prospectId` fields make authorization predicates explicit; M2 does not depend on client-side relation traversal for ownership.

`failureCode` is one of `INVALID_TARGET`, `BLOCKED_TARGET`, `ROBOTS_BLOCKED`, `TIMEOUT`, `UNREACHABLE`, `INVALID_RESPONSE`, `RESPONSE_TOO_LARGE`, or `INTERNAL_ERROR`. `failureMessage` is a fixed safe explanation selected by code, never a raw network or database exception.

## Engine Contract

The package exposes a narrow interface:

```ts
type AuditEngineResult = {
  requestedUrl: string;
  finalUrl: string;
  pagesAttempted: number;
  pagesAudited: number;
  durationMs: number;
  checks: AuditFinding[];
};

type AuditFinding = {
  category: "ACCESSIBILITY" | "TRUST" | "SEO" | "TECHNICAL" | "PERFORMANCE";
  key: string;
  label: string;
  status: "PASS" | "WARNING" | "FAIL";
  summary: string;
  evidence: Record<string, string | number | boolean | null>;
};

runWebsiteAudit(url: string, dependencies?: AuditDependencies): Promise<AuditEngineResult>;
```

Failures use a typed engine error containing only a stable failure code and safe message. Fetch and DNS functions are injectable so tests use deterministic fixtures rather than live websites.

## Checks

Checks are deterministic and produce one stable key per audit. Multi-page evidence is aggregated rather than creating duplicate keys per page.

### Accessibility

- `page_title`: every audited page has a non-empty title; warning if only some do, fail if none do.
- `meta_description`: descriptions exist across the sample using the same aggregation rule.
- `heading_structure`: each page has one useful H1 and does not skip directly from H1 to H3+; warnings represent partial compliance.
- `image_alt_coverage`: pass at 95%+, warning at 70–94%, fail below 70%; decorative empty-alt images are excluded when identifiable.
- `form_label_coverage`: pass at 95%+, warning at 70–94%, fail below 70% for auditable controls.
- `document_language`: HTML language is declared across the sample.

### Trust and conversion

- `https`: final homepage and audited pages use HTTPS.
- `contact_path`: a same-origin contact page or prominent contact link exists.
- `contact_signals`: a phone or email link/text signal exists.
- `calls_to_action`: button/link language includes at least one clear action such as contact, call, book, request, quote, buy, or schedule.
- `privacy_policy`: a privacy-policy link exists.
- `terms_link`: a terms, conditions, or legal link exists; absence is a warning rather than a fail.

### SEO and discoverability

- `canonical_url`: canonical links exist and resolve to HTTP(S) URLs.
- `robots_meta`: no audited page contains `noindex`; mixed samples warn and all-noindex fails.
- `robots_txt`: robots.txt is reachable or explicitly absent; malformed or unavailable files warn.
- `sitemap`: a sitemap is declared in robots.txt or available at `/sitemap.xml`.
- `structured_data`: valid JSON-LD blocks exist; absence is a warning.

### Technical health

- `http_status`: audited pages return successful HTML responses.
- `redirect_chain`: homepage uses at most one redirect for pass, two or three for warning, and four or five for fail.
- `broken_internal_links`: validate a bounded sample of up to twenty unique same-origin links with HEAD and a GET fallback; pass with zero broken, warning with one, fail with two or more.
- `viewport_meta`: every audited page declares a viewport.
- `mixed_content`: HTTPS pages contain no explicit HTTP asset references.

### Performance indicators

- `server_response_time`: homepage headers arrive below 800 ms for pass, 800–1,500 ms for warning, and above 1,500 ms for fail.
- `html_size`: total homepage HTML is below 250 KB for pass, 250–750 KB for warning, and above 750 KB for fail.
- `image_count`: homepage uses 30 or fewer images for pass, 31–60 for warning, and more than 60 for fail.
- `script_count`: homepage uses 20 or fewer external scripts for pass, 21–40 for warning, and more than 40 for fail.
- `render_blocking_resources`: zero or one blocking stylesheet/script passes, two to five warns, and more than five fails.

These are HTTP/HTML indicators, not Core Web Vitals or Lighthouse claims. UI copy must not describe them as lab or field performance scores.

## Application Flow

1. On an owned prospect detail page, the owner clicks Run audit.
2. The Server Action authenticates and allowlists the user, loads the prospect using `{ id, userId }`, and rejects a missing website before any audit row is created.
3. It creates a `RUNNING` audit with the normalized requested URL.
4. The engine validates the target and executes the bounded crawl.
5. On success, one transaction creates all `AuditCheck` records and updates the run to `COMPLETED` with final URL, coverage, duration, and completion time.
6. On engine failure, the action updates the run to `FAILED` with the stable safe code/message and duration.
7. If completion persistence fails, the action attempts to mark the run `FAILED` with `INTERNAL_ERROR`, logs the original error, and returns a safe action error. No success is reported for a partially persisted audit.
8. A completed or safely failed run redirects to `/audits/[id]`. Authentication/database failures before an audit ID exists return a generic inline error.

Only one audit may run per prospect in a single process at a time. The action checks for an existing `RUNNING` record created within the last five minutes and returns its result link rather than starting another. Older running records are treated as stale and do not block a rerun.

## Routes and UI

### Navigation

Add `Audits` alongside Dashboard, Prospects, and Settings. No navigation is added for later milestones.

### Prospect detail

Add a Website Audit panel showing:

- the normalized website hostname;
- latest audit status and timestamp when present;
- Run audit or Run again action;
- a link to the latest result;
- a clear disabled state and edit-prospect link when no website is stored.

### `/audits`

Display owner-scoped audit history ordered newest first, paginated at 25. Each row shows prospect, domain, status, pages audited, duration, created time, and a result link. Status filtering supports All, Completed, and Failed. No placeholder metrics or score columns appear.

### `/audits/[id]`

Load the audit using both `id` and authenticated `userId`; a missing or other-owner audit returns `notFound()`.

The page shows prospect/domain context, status, crawl coverage, duration, timestamps, and a rerun action. Completed results group checks by category. Within each category, failures appear before warnings and passes. Each check presents its label, status, summary, and a concise allowlisted rendering of evidence values. Raw JSON is not dumped into the page.

Failed runs show the safe failure explanation and a rerun action without fabricated checks.

## Logging and Error Handling

Structured events include:

- `audit.run.started`
- `audit.run.succeeded`
- `audit.run.failed`
- `audit.persistence.failed`

Metadata may include user ID, prospect ID, audit ID, safe failure code, duration, and pages audited. Logs must not include fetched HTML, notes, contact data, raw URLs with credentials or query strings, resolved database credentials, or raw form submissions.

Unexpected UI errors use stable generic messages. The server logs the original exception object only through the existing structured logger.

## Testing Strategy

Tests cover LeadForge-owned behavior rather than underlying Clerk, Prisma, parser, DNS, fetch, or console-library behavior:

- audit initiation derives owner identity from `auth().userId` and ignores submitted user IDs;
- signed-out, non-allowlisted, missing, and other-owner prospects cannot start audits;
- prospects without websites fail before persistence;
- existing recent running audits suppress duplicates;
- completed findings persist atomically and failed engine runs persist safe failure state;
- database failures produce safe responses and structured error events;
- target policy rejects unsupported protocols, credentials, localhost, private/reserved addresses, unsafe DNS answers, and unsafe redirects;
- crawl policy enforces same origin, robots exclusions, page/redirect/link/size/time limits, and non-HTML skipping;
- fixture pages map to the documented deterministic pass/warning/fail thresholds;
- audit history and detail queries scope by authenticated owner and hide other-owner records.

Network tests use injected fetch and DNS fixtures. No test contacts a live website. Tests do not merely assert Zod, Prisma, Clerk, HTML-parser, DNS-library, or console behavior.

## Acceptance Flow

1. The allowlisted owner opens a prospect with a public website and starts an audit.
2. LeadForge validates the target and crawls no more than five allowed same-origin pages.
3. A completed immutable audit and structured checks persist.
4. Results show grouped pass, warning, and fail evidence without an overall score or AI recommendation.
5. Refresh preserves the result, and audit history displays prior runs newest first.
6. Rerunning creates a new immutable audit.
7. Invalid, private, robots-blocked, unreachable, oversized, or timed-out targets fail safely.
8. Another user cannot initiate or view the owner's audits.
9. `bun run check`, `bun run test`, `bun run build`, and migration deployment pass.
10. The existing single Vercel deployment supports the same bounded flow.

## Operational Changes

- Add the `packages/audit-engine` workspace package and its focused tests.
- Add and deploy one Prisma migration for website audits and findings.
- Add no environment variables, external accounts, Vercel projects, queues, or storage integrations.
- Document that synchronous audit duration is intentionally bounded and that a later async milestone must preserve the engine result contract.

## Deferred Decisions

M3 will design opportunity scoring and recommendations using stored M2 findings. Browser-based Lighthouse runs, screenshots, asynchronous execution, retries, scheduled audits, multi-region workers, storage, and QStash remain deferred until measured runtime or product requirements justify them.

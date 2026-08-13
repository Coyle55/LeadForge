# Phase 3: AI-Powered Prospect Discovery Design

Date: 2026-08-06  
Status: Approved for implementation planning

## Objective

Eliminate manual prospect creation as the primary entry point into LeadForge. An owner searches for a business type and location, previews AI-discovered candidates with supporting evidence, imports only the ones they choose, and those prospects flow into the existing audit → opportunity → recommendation → outreach pipeline unchanged. Discovery never mutates the database on its own — only an explicit import does.

## Scope

Phase 3 includes:

- a provider-agnostic `ProspectDiscoveryProvider` interface, with one real implementation (`PerplexityGatewayDiscoveryProvider`) built on the Vercel AI Gateway's built-in Perplexity Search tool plus an Anthropic reasoning model for extraction/structuring — not a direct Anthropic BYOK integration (see Architecture)
- a search modal on the existing `/prospects` page (no new top-level page) with Business Type, Location, and Result Limit fields
- a preview-only results view with per-result confidence, source links, and duplicate status, supporting select-all/deselect-all
- an idempotent import flow that creates `Prospect` rows with preserved source metadata
- an "Import + Audit" path that imports first, then runs the existing (synchronous) audit action sequentially over the imported prospects, capped at 10, with visible per-item progress — never described as "queued," since no background-job system exists in this codebase
- domain/phone/name normalization and priority-ordered duplicate detection against the owner's existing prospects
- a database-backed search cache, versioned so a prompt/schema/model change never serves stale-shaped results
- an import-batch summary record, used only to power the post-import results summary — no batch-management UI

Phase 3 excludes Google Places, Google Maps scraping, SerpApi, any other discovery provider, automatic recurring discovery, contact enrichment, email guessing, bulk outreach, a dashboard redesign, new CRM pages, a mobile app, and any real background-job/queue infrastructure.

## Product philosophy

Discovery is the front door; the CRM manages what discovery produces. Every discovered business must be human-reviewed before it becomes a `Prospect` — the application never auto-imports a search result. Every field on a discovered business is either grounded in a real search result or explicitly left blank; nothing is fabricated.

## Architecture: why Perplexity-via-Gateway, not direct Claude web search

The spec's original intent was Claude's native web search tool. That tool (`anthropic.tools.webSearch_20250305`, from the `@ai-sdk/anthropic` package) requires a direct Anthropic Console account with web search explicitly enabled and likely a direct `ANTHROPIC_API_KEY` — this codebase has zero direct provider keys today; every existing AI call (opportunity interpretation, outreach generation) routes through the Vercel AI Gateway using OIDC auth and plain `"provider/model"` strings. Introducing a first-ever direct provider credential for one feature would be a real architectural regression.

The Gateway ships its own provider-agnostic, gateway-executed tool, `gateway.tools.perplexitySearch()`, confirmed importable from the top-level `ai` package with zero new credentials. The design uses this for retrieval, with an Anthropic model (via Gateway, same as every other AI call in this app) doing the reasoning: interpreting search results, extracting structured business data, and refusing to fabricate anything not actually present in what Perplexity returned. The concrete class is named `PerplexityGatewayDiscoveryProvider` — accurate about which system performs retrieval — and the `sourceProvider` value stored is `"PERPLEXITY_GATEWAY_SEARCH"`, not `"CLAUDE_WEB_SEARCH"`.

Confirmed via the AI SDK's own troubleshooting docs: combining a provider-executed tool with a final structured `output: Output.object(...)` in one `generateText` call is supported, using `stopWhen: isStepCount(n)` to allow for the tool-call step(s) plus the final structured-output step.

## Provider interface

```ts
export interface ProspectDiscoveryInput {
  businessType: string; // required, non-empty
  location: string;     // required, non-empty
  resultLimit: number;  // 1-25, default 10
}

export type DiscoveryConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface DiscoveredProspect {
  discoveryId: string;       // locally-derived, stable (see Identity)
  providerCandidateId?: string; // provider-native id, if the tool exposes one
  businessName: string;
  category?: string;
  websiteUrl?: string;       // present but unverified is allowed; see Import Eligibility
  websiteVerified: boolean;
  phone?: string;
  formattedAddress?: string;
  city?: string;
  state?: string;
  sourceUrls: string[];      // non-empty required for any candidate to appear at all
  confidence: DiscoveryConfidence;
}

export interface ProspectDiscoveryResult {
  results: DiscoveredProspect[];
  rejected: Array<{ reason: string }>; // per-candidate validation failures, counted not detailed
  query: string;
  location: string;
  provider: string;
  reasoningModel: string;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ProspectDiscoveryProvider {
  search(input: ProspectDiscoveryInput): Promise<ProspectDiscoveryResult>;
}
```

Search never touches the database. `PerplexityGatewayDiscoveryProvider` is the only implementation; nothing outside it may reference Perplexity, Anthropic, or Gateway-specific types — the UI and import flow depend only on this interface, matching the existing `ScreenshotProvider` precedent.

## Identity (no model-generated IDs)

`discoveryId` is derived locally, deterministically, never invented by the model:
- `normalizeDomain(websiteUrl)` when a website is present, or
- otherwise a stable hash of `normalizeName(businessName) + normalizeAddress(formattedAddress)`.

If the search tool's raw output exposes a provider-native result identifier, it's preserved separately as `providerCandidateId` — informational only, never used as the primary key for dedup or caching.

## Per-candidate validation (never all-or-nothing)

The model's raw structured output is validated one candidate at a time. A candidate is **rejected** (dropped from `results`, counted in `rejected`) only if it's missing `businessName` or has an empty `sourceUrls` array — the absolute minimum grounding requirements. A candidate **missing only `websiteUrl`** is still valid and still appears in the preview, with `websiteVerified: false` and a UI label "Official website not verified" — it is simply ineligible for the import checkbox, not silently discarded. One malformed candidate never fails the whole search.

## Data model (additive only)

```prisma
// on Prospect
sourceProvider   String?
sourceExternalId String?
sourceUrls       Json?

model ProspectImportBatch {
  id             String   @id @default(cuid())
  userId         String
  provider       String
  reasoningModel String
  query          String
  location       String
  requestedCount Int
  returnedCount  Int
  importedCount  Int
  skippedCount   Int
  failedCount    Int
  createdAt      DateTime @default(now())

  @@index([userId, createdAt])
}

model ProspectDiscoveryCache {
  id           String   @id @default(cuid())
  userId       String
  cacheKey     String   // see Caching
  result       Json
  inputTokens  Int?
  outputTokens Int?
  createdAt    DateTime @default(now())

  @@unique([userId, cacheKey])
}
```

`reasoningModel` and token usage live on the batch/cache rows, not on every `Prospect` — knowing which model reasoned about a specific business matters at the batch/audit-trail level, not per-record. `ProspectImportBatch` exists solely to power the post-import summary screen ("Imported 6, Skipped 2, Failed 0") — no separate batch-history or batch-management UI is built in this phase.

## Deduplication

Priority order, checked against the owner's existing (non-archived-agnostic — dedup checks all prospects regardless of archive state, since archiving doesn't erase a business's identity) prospects: **domain → `sourceExternalId` → phone → name+address**, first match wins. New pure normalization helpers:

- `normalizeDomain(url)` — lowercase hostname, strip `www.`, strip trailing slash and path.
- `normalizePhone(phone)` — digits only.
- `normalizeName(name)` — lowercase, collapsed whitespace, stripped punctuation.
- `normalizeAddress(address)` — lowercase, collapsed whitespace, stripped punctuation.

Dedup runs **twice**: once at preview time (labeling "Already Imported" per candidate) and again inside the import transaction itself, so a stale preview can never produce a duplicate `Prospect` — import is idempotent regardless of what the client believes.

## Caching

A DB-backed cache (no new infrastructure), keyed by a hash of `(userId, provider, reasoningModel, DISCOVERY_PROMPT_VERSION, normalizeName(businessType), normalizeAddress(location), resultLimit)`. Including the provider, model, and a versioned prompt constant (matching the existing `OPPORTUNITY_PROMPT_VERSION`/`OUTREACH_PROMPT_VERSION`/`INTERPRETATION_PROMPT_VERSION` pattern already in this codebase) means any future prompt, schema, or model change automatically invalidates old cache entries rather than serving incompatible stale shapes. Default TTL 60 minutes, configurable via env. **Only a search that returns at least one valid candidate is cached** — a provider error, timeout, or a response where every candidate was rejected is never cached, so a transient failure doesn't poison repeat attempts for the TTL window.

## Cost controls

Result limit: 1-25, default 10, Zod-enforced server-side (never trust a client-submitted limit above 25). Caching absorbs repeat identical queries. Structured log per search: duration, provider, reasoning model, requested/returned/rejected counts, input/output token counts — never prompts, raw provider payloads, or secrets. Token usage is the cost proxy actually available from the SDK response; no separate cost-estimation API exists to call. Import + Audit is capped at 10 sequential audits per batch.

## Search UI (extends `/prospects`, no new page)

A "Discover Businesses" button opens a modal: Business Type (required, empty by default), Location (required, defaults to a configured value), Result Limit (1-25, default 10). Submitting calls the search action and renders a preview table below the modal (or in a drawer) — never writes to the database. Each row shows business name, category, website (or "Official website not verified"), phone, address, confidence, source links, and duplicate status. Select All / Deselect All controls, plus two commit actions: **Import Selected** and **Import + Audit Selected**. The import checkbox is disabled for any candidate without a verified website or already marked "Already Imported."

## Import

Only selected, eligible candidates are imported. Each import: re-runs dedup against current data (not the stale preview), normalizes fields through the existing `prospectSchema`, creates the `Prospect` at `pipelineStage: NEW` with `sourceProvider`/`sourceExternalId`/`sourceUrls` preserved, and is independent of every other item in the batch — one failure doesn't roll back the others. Returns `{ imported: [], skipped: [], failed: [] }`, and persists a `ProspectImportBatch` summarizing the counts.

## Import + Audit

Import commits first, in full, before any audit runs. Only after a successful commit does the action sequentially call the existing `runProspectAudit(prospectId)` — one at a time, awaited, capped at 10 total per batch — with the UI showing live per-item progress (pending/running/succeeded/failed) as each completes. This is **explicitly not a queue**: there is no background-job system in this codebase, and the implementation and its UI copy must never imply one. If an audit fails or throws, the already-imported prospects are never affected — only that one audit is marked failed, and the owner can retry it manually from the prospect later (reusing the existing single-prospect audit trigger, no new retry-specific code path required). Outreach is never auto-generated from this flow.

## Testing

Tests prioritize: query validation (required fields, 1-25 bound); per-candidate validation (accepts valid candidates, rejects only those missing name/sourceUrls, never rejects a whole batch for one bad candidate); domain/phone/name/address normalization; duplicate-detection priority order with no cross-business false positives; owner scoping throughout; import idempotency (re-importing a duplicate, whether flagged by a fresh or stale preview, creates nothing new); partial-import-failure isolation; cache key versioning (a prompt-version or model change produces a cache miss even for identical query text); cache never persists on error or all-candidates-rejected; import-then-audit ordering (audits never start before the import transaction commits, a queueing/execution failure never unwinds the import, and the cap of 10 is enforced); provider failures surface a safe error, never a raw provider/gateway error.

## Manual verification checklist

1. Open `/prospects`, click "Discover Businesses" — modal defaults: Business Type empty, Location prefilled, Result Limit 10.
2. Search "Plumbers" / "Cincinnati, OH" — preview appears; confirm zero new rows in the existing Prospects list (no DB write from search alone).
3. Confirm every result has at least one clickable, real source link.
4. Confirm any result missing a website shows "Official website not verified" and its import checkbox is disabled.
5. Repeat the identical search immediately — confirm it resolves near-instantly (cache hit, no new AI Gateway call in the logs).
6. Select All → Import Selected — confirm new prospects appear at stage `NEW` with source metadata preserved, and a post-import summary shows accurate imported/skipped/failed counts.
7. Repeat the same search — confirm previously-imported businesses show "Already Imported," and attempting to import them again creates no duplicates.
8. Import + Audit Selected on a small selection — confirm prospects are created, then audits run sequentially with visible per-item progress (never labeled "queued"), capped at 10.
9. Confirm no application console errors throughout.

## Non-goals (explicit)

No Google Places, no Google Maps scraping, no SerpApi, no additional discovery providers in this phase, no automatic recurring discovery, no contact enrichment or email guessing, no bulk outreach, no dashboard redesign, no new CRM pages, no mobile app, and no real background-job/queue infrastructure — sequential capped execution with visible progress is the deliberate, honest choice for Import + Audit in this phase.

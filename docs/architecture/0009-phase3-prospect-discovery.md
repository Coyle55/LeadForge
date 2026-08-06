# ADR 0009: Phase 3 AI-powered prospect discovery

Status: Accepted

Date: 2026-08-06

## Context

Before this phase, every `Prospect` row was created by hand, one business at a time, on the existing create-prospect form. The owner already had to research and identify a target business before LeadForge could do anything useful with it — audit it, score it, draft outreach. Phase 3 automates the front end of that funnel: search for real businesses by type and location, review AI-discovered candidates with their supporting evidence, and import only the ones worth pursuing. The downstream workflow (audit → deterministic score → AI interpretation → outreach) built in Phase 2 is untouched; this phase only adds a new way to get a `Prospect` row into that pipeline.

## Decision

### Gateway-routed search instead of a direct Anthropic web-search key

The original ask was Claude's native server-side web search. That tool (`anthropic.tools.webSearch_20250305`) requires a direct Anthropic Console account with web search enabled, and per the AI Gateway's own documentation, "some provider-executed tools require account-specific configuration... you must bring your own key (BYOK) directly to the provider" — it is not purely OIDC/Gateway-routable. This codebase has zero direct provider API keys anywhere, by deliberate design (every AI call already routes through Vercel AI Gateway via OIDC). Introducing one just for discovery would have broken that invariant.

Instead, discovery uses the AI Gateway's own built-in `gateway.tools.perplexitySearch()` tool — a Gateway-executed tool requiring no new credentials — paired with a Claude reasoning model (`anthropic/claude-haiku-4.5` at the time of writing) that receives the search results and extracts/structures candidate businesses from them via `generateText` with `tools` + `output: Output.object(...)` + `stopWhen: isStepCount(...)`, the AI SDK v7 pattern for combining tool calls with structured final output in one call. Perplexity performs retrieval; Claude performs reasoning and extraction. The implementation is named `PerplexityGatewayDiscoveryProvider`, not `ClaudeWebSearchDiscoveryProvider`, to reflect which model is doing which job.

### Provider interface, not a hardcoded call

`ProspectDiscoveryProvider` (`apps/app/app/lib/discovery/types.ts`) is a one-method interface (`search(input): Promise<ProspectDiscoveryResult>`), matching the precedent already established by `packages/audit-engine/screenshot.ts`'s `ScreenshotProvider`. `PerplexityGatewayDiscoveryProvider` is the only implementation today. Swapping in Google Places, direct Anthropic web search (once BYOK is acceptable), or any other provider later means writing a new class against this interface — nothing in the search action, the caching layer, or the UI depends on which provider is behind it.

### Locally-derived identity, never a model-generated ID

`DiscoveredProspect.discoveryId` is always computed by this codebase, never trusted from the model: `normalizeDomain(websiteUrl)` when a website is present, otherwise a deterministic hash of `normalizeName(businessName) + normalizeAddress(formattedAddress)`. A provider-native identifier, if the search tool exposes one, is preserved separately as `providerCandidateId` and is never used as a dedup or cache key. This closes off an entire class of problems that would exist if an LLM were trusted to invent stable identifiers (inconsistent formatting, non-determinism across calls, no guarantee of uniqueness).

Two real limitations found through testing, both broader than initially scoped:

First, when a candidate has neither a website nor a `formattedAddress` (only `city`/`state`), the hash falls back to `businessName` alone, since `city`/`state` are not part of the hash input. A national franchise name (e.g. "Roto-Rooter") appearing in two different cities without a captured street address will collide onto the same `discoveryId`. This did not cause an incorrect import in acceptance testing (neither instance had a verified website, so both were import-ineligible regardless), but it is a known gap: `city`/`state` should likely be folded into the fallback hash in a future pass.

Second, the collision is not limited to the no-website fallback case: a domain-derived `discoveryId` (`normalizeDomain(websiteUrl)`) collides just as easily whenever two distinct physical locations of the same business share one website — a common real-world pattern for small local chains (e.g. two salon locations both linking to the same corporate domain), confirmed via manual UI testing with two real, differently-addressed "Deluxe Nail Salon & Spa" locations sharing `deluxenailsalonandspa.com`. The preview UI's row selection is keyed by array index rather than `discoveryId` specifically to prevent this from causing one checkbox to silently select/import both rows, but the underlying identity model still cannot distinguish two same-domain locations from each other — importing both would currently produce two `Prospect` rows with an identical `sourceExternalId`. Resolving this properly likely means folding `formattedAddress` (when present) into the identity even when a domain is available, which is a real design change to the identity model established in Task 3, not a one-line fix, and is deferred rather than patched under time pressure.

### Per-candidate validation, never whole-response rejection

`validateCandidate` (`apps/app/app/lib/discovery/schema.ts`) validates each candidate independently. A candidate is rejected only for a missing `businessName` or an empty `sourceUrls` array; every other field is tolerant of the model's actual observed output shapes rather than the theoretically "correct" shape — `confidence` falls back to `"LOW"` rather than rejecting when absent or invalid, empty-string optional fields are treated as absent rather than as validation failures, and (found on the live acceptance run, not by any mocked test) a `sourceUrls` value returned as a bare string rather than a one-element array is coerced rather than rejected. One bad or oddly-shaped candidate is recorded in `rejected` with a reason; it never fails the rest of the search.

### Missing website is a labeled, not hidden, ineligibility

`websiteVerified` (`Boolean(candidate.websiteUrl)`, as decided by the provider) plus a non-blank `websiteUrl` are both required before `importProspects` will create a `Prospect` row for a candidate — re-checked server-side on every import call, never trusting a client-submitted `websiteVerified: true`. In the UI, a candidate without a verified website is still shown in the preview table, labeled "Official website not verified," with a disabled checkbox — never silently dropped from the results. On the acceptance run, 3 of 5 real Cincinnati candidates and all 5 real Dayton candidates fell into this category: the model found a plausible source URL for each but declined to assert it as the confirmed official site. This conservative behavior is intended — never fabricate a website — but it means the realistic import-eligible yield per search is often lower than the total candidate count.

### Deterministic dedup, checked twice

`findDuplicateProspectId` (`apps/app/app/lib/discovery/duplicates.ts`) matches by domain, then provider-supplied external ID, then phone, then normalized name+address — first match wins, each tier skipped entirely for a candidate/prospect missing that field (an absent phone never matches another absent phone). This runs once at preview time (`searchProspects`, for the "already imported" label) and again, independently, inside `importProspects` against the database state at the moment of import — never trusting whatever duplicate status the client saw during preview, since time may have passed or the client's copy may be stale.

### Cache is versioned and only stores successes

`ProspectDiscoveryCache` keys on a hash of `(provider, reasoningModel, DISCOVERY_PROMPT_VERSION, normalized businessType, normalized location, resultLimit)`, scoped per owner. A prompt, schema, or model change is a different key, so it can never serve a stale, incompatible cached shape. Only a result with at least one valid candidate is cached; a provider error or an all-rejected response is never cached, so a transient failure doesn't get "stuck" for the TTL window. Cache hits are cheap (a few hundred milliseconds observed vs. ~10-20 seconds for a real Gateway call) but the duplicate-status annotation on every result is always recomputed fresh against current data, cache hit or not — a cached search result reflects the business data at fetch time, but "is this already in my pipeline" must always reflect right now.

### Import + Audit is honestly sequential, not a queue

`importAndAuditProspects` imports first (fully committing before any audit starts), then runs the existing website-audit engine one prospect at a time, awaited, capped at 10 per batch. This codebase has no background-job infrastructure, so nothing here is described as "queued" — a prospect beyond the cap simply has no audit attempted at all, distinct from an attempted-and-failed one. Making this possible required a small, behavior-preserving refactor of the pre-existing `apps/app/app/actions/audits.ts`: the original `runProspectAudit` unconditionally called `redirect()` on every non-error path, which would have aborted a loop on the first iteration. The redirect-free core was extracted into `runAuditForProspect`, and `runProspectAudit` became a thin wrapper preserving its exact existing behavior for its one existing caller.

Acceptance testing measured two real sequential audits at roughly 9-10 seconds each. Scaled to the 10-prospect cap, that projects to roughly 90-100 seconds for a single batch — a real risk of approaching a serverless function's default duration limit depending on the deployment platform's configuration. This phase does not change the cap or introduce a queue to work around it; that tradeoff is a deliberate architecture decision for a future phase, not something to solve implicitly here.

### Data model

Purely additive: `Prospect` gains `sourceProvider`, `sourceExternalId`, `sourceUrls` (all nullable). Two new tables: `ProspectImportBatch` (one row per import call, powering the import summary shown in the UI — no separate batch-management UI was built, since nothing else in this phase needs one) and `ProspectDiscoveryCache` (one row per owner+cache-key). No existing column was altered.

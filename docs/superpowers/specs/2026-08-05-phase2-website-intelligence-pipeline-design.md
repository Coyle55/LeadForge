# Phase 2: Website Intelligence Pipeline Design

Date: 2026-08-05  
Status: Approved for implementation planning

## Objective

LeadForge's core value is answering one question: which local businesses are most likely to benefit from software or AI services, and why. M1–M4 already built most of the underlying workflow (prospect → website audit → opportunity analysis → outreach draft), but the opportunity-scoring step is currently AI-generated end to end, which makes scores unreproducible and untraceable. Phase 2 replaces AI scoring with a deterministic, evidence-traceable rules engine, adds the small set of audit checks the workflow is still missing, and adds an explicit, human-controlled "mark sent" and follow-up flow. AI is demoted to a bounded interpretation layer that explains an already-computed score — it never invents a number again.

## Scope

Phase 2 includes:

- a deterministic opportunity-scoring engine, replacing the AI-generated score
- a deterministic, weighted recommendation-mapping engine, replacing AI-selected services
- a bounded AI interpretation layer that explains the deterministic score/recommendations, never computes them
- four missing audit checks: booking detection, broken-image detection, copyright-year staleness, and split phone/email detection, plus a pluggable (currently no-op) screenshot-provider interface so screenshot capture can be added later without a pipeline change
- an explicit outreach "mark sent" flow with a new `ProspectActivity` log and a suggested (never automatic) follow-up task
- a manually-set `businessCategory` field on `Prospect`, used only to scale booking-detection weight for appointment-driven businesses

Phase 2 excludes new top-level pages, dashboard/report widgets, CRM modules, automated sending, discovery/scraping providers, background job queues, and any other architecture not named above.

## Architecture

Everything stays inside `apps/app` with Prisma/PostgreSQL as the persistence boundary, matching every prior milestone. No queue, scheduler, or second service is introduced — audits and analyses continue to run synchronously within the triggering request, matching the existing M2–M4 pattern.

## Deterministic scoring engine

Scoring rules live in a single configurable module, `apps/app/app/lib/opportunity/scoring-rules.ts`, mapping each `AuditCheck.key` to point values by status (WARNING/FAIL), with fixed category caps so cosmetic categories can never dominate:

| Category | Cap |
|---|---|
| Trust | 50 |
| Technical | 45 |
| Performance | 25 |
| Booking | 8 (16 for appointment-driven business categories) |
| Accessibility | 12 |
| SEO | 8 |
| Freshness | 2 |

Point table (points awarded when not PASS):

| Check key | WARNING | FAIL |
|---|---|---|
| https | 10 | 20 |
| contact_path | — | 15 |
| calls_to_action | 6 | 10 |
| privacy_policy | 3 | 5 |
| terms_link | 2 | 3 |
| phone_detection (new) | — | 10 |
| email_detection (new) | — | 8 |
| http_status | 15 | 30 |
| viewport_meta | — | 12 |
| broken_internal_links | 4 | 8 |
| redirect_chain | 3 | 6 |
| mixed_content | — | 5 |
| broken_images (new) | 3 | 6 |
| server_response_time | 4 | 8 |
| render_blocking_resources | 3 | 6 |
| html_size | 2 | 4 |
| image_count | 2 | 4 |
| script_count | 2 | 4 |
| booking_detection (new) | — | 8 (×2 for appointment-driven categories) |
| page_title | 1 | 3 |
| heading_structure | 1 | 3 |
| meta_description | 1 | 2 |
| image_alt_coverage | 1 | 2 |
| form_label_coverage | 1 | 2 |
| document_language | — | 1 |
| robots_meta | 1 | 3 |
| canonical_url | 1 | 2 |
| robots_txt / sitemap / structured_data | 1 each | — |
| copyright_year (new) | 2 | 2 |

`contact_signals` is removed and replaced entirely by `phone_detection`/`email_detection`.

Negative modifiers (subtracted from the category's raw points, floored at 0, applied only when the underlying check PASSes with a strong result):

| Condition | Modifier |
|---|---|
| `server_response_time` PASS with response < 300ms | −3 performance |
| `contact_path`, `phone_detection`, and `email_detection` all PASS | −4 trust |
| `calls_to_action` PASS | −2 trust |
| `booking_detection` PASS | −4 booking |

`overallScore = min(100, sum of capped category totals)`. Each `categoryScores.<category>` is an independent `min(100, rawCategoryPoints / maxPossibleForCategory * 100)` reading, unaffected by the cross-category cap.

Tiers: Excellent 80–100, High 60–79, Medium 30–59, Low 0–29.

Disqualifiers (evidence-based only, skip scoring/recommendations entirely):
- `AUDIT_INCOMPLETE`: `pagesAudited === 0`
- `SITE_UNREACHABLE`: every attempted page returned a non-2xx/network failure

Top reasons: all triggered (non-PASS) findings sorted by point contribution descending, top 5 kept, each with `{ checkKey, points, category, evidence }` — this is what renders as the concise score breakdown in the UI.

## Deterministic recommendation engine

A weighted mapping table in `apps/app/app/lib/opportunity/recommendation-rules.ts` maps triggered signals to one of five fixed service categories:

| Signal | Weight | Service |
|---|---|---|
| calls_to_action FAIL / WARN | 3 / 2 | Website redesign |
| viewport_meta FAIL | 3 | Website redesign |
| broken_internal_links FAIL | 2 | Website redesign |
| broken_images FAIL | 1 | Website redesign |
| mixed_content FAIL | 1 | Website redesign |
| server_response_time FAIL / WARN | 3 / 2 | Performance optimization |
| render_blocking_resources / html_size / script_count FAIL | 1 each | Performance optimization |
| booking_detection FAIL | 3 (×2 for appointment-driven categories) | Booking integration |
| contact_path FAIL | 2 | Lead-capture repair |
| phone_detection FAIL | 2 | Lead-capture repair |
| email_detection FAIL | 1 | Lead-capture repair |
| booking_detection FAIL and (phone_detection FAIL or email_detection FAIL) | 3 | Lead-response automation |

Weights sum per service; services scoring ≥3 are kept, sorted descending, capped at the top 2. If nothing clears the threshold but at least one signal fired, the single highest-weighted service is kept — never zero recommendations when real problems exist, and genuinely healthy sites get none. `effort` is a fixed lookup per service (redesign=HIGH, performance=MEDIUM, booking=MEDIUM, lead-capture=LOW, lead-response=MEDIUM); `impact` derives from the service's total weight. `confidence` is derived from the same total weight: ≥6 HIGH, 4–5 MEDIUM, 3 LOW.

## Business category (new, minimal)

`Prospect.businessCategory` (new nullable enum) is manually set by the owner — there is no automated business-classification service. Starter taxonomy: `SALON_SPA`, `MEDICAL_DENTAL`, `HOME_SERVICES`, `AUTOMOTIVE`, `FITNESS`, `LEGAL_FINANCIAL`, `RESTAURANT_FOOD`, `RETAIL`, `PROFESSIONAL_SERVICES`, `OTHER`. Appointment-driven (booking weight ×2): `SALON_SPA`, `MEDICAL_DENTAL`, `FITNESS`, `AUTOMOTIVE`, `LEGAL_FINANCIAL`. All others, and unset, use the base weight. This taxonomy is a starting assumption, easy to adjust — not a stated requirement.

## AI interpretation layer

The AI call is bounded and receives only: `{ tier, overallScore, categoryScores, scoringBreakdown, topReasons, disqualifiers, recommendations (with serviceCategory already chosen) }`. It returns `{ summary, strongestIssue, practicalImpact, suggestedOffer, confidence, warnings }` and must never introduce a number not already present in its input. It never selects a service or computes a score — both already exist before this call runs.

## Model changes (additive, minimal)

`OpportunityAnalysis`: add nullable `tier` (new enum), `scoringBreakdown Json?`, `topReasons Json?`, `disqualifiers Json?`, `strongestIssue String?`, `suggestedOffer String?`, `confidence` (enum HIGH/MEDIUM/LOW), `warnings Json?`, and `scoringMethod` (enum `AI_LEGACY | DETERMINISTIC`, backfilled to `AI_LEGACY` for existing rows, defaulting to `DETERMINISTIC` going forward). Keep `overallScore`/`categoryScores` (same shape, now rule-computed) and `executiveSummary`/`overallRationale` (repurposed to hold the AI layer's "Summary"/"Practical impact" text) so existing rows remain fully readable, clearly tagged as legacy AI-scored.

`OpportunityRecommendation`: add `serviceCategory` (new enum, the 5 services above) and `confidence` (enum HIGH/MEDIUM/LOW). `impact`/`effort` become deterministic; `title`/`rationale`/`action` remain AI-authored framing text for the already-chosen category.

`Prospect`: add nullable `businessCategory` (new enum) and `lastContactedAt DateTime?`.

New `ProspectActivity` model — the smallest useful activity log, not a generic event system: `id`, `userId`, `prospectId`, `type` (enum, starting with `OUTREACH_SENT`), `occurredAt`, `metadata Json?` (e.g., the outreach draft ID and sent subject/body snapshot reference).

`OutreachDraftStatus` gains a `SENT` value alongside existing `RUNNING | COMPLETED | FAILED`. `OutreachDraft` gains `sentAt DateTime?`, `sentSubject String?`, `sentBody String?` (an immutable snapshot of exactly what was sent, independent of any later edits to the working copy).

## Missing audit checks

Added to `packages/audit-engine`, each independently testable, none capable of failing the overall audit:

- **Screenshot capture is deferred for this phase**, per explicit decision: no paid browser-automation vendor (Browserbase, Kernel, or otherwise) is introduced now. Instead, the audit pipeline exposes a `ScreenshotProvider` interface (`capture(url): Promise<{ status: "captured"; url: string } | { status: "unavailable"; reason: string }>`) with a single no-op implementation that always returns `{ status: "unavailable", reason: "not_configured" }`. `WebsiteAudit` gains a nullable `screenshotUrl` column and the check pipeline calls the provider and records whatever it returns — "unavailable" is a normal, non-failing outcome, never a blocker. This lets a real provider be swapped in later purely by implementing the interface, with no changes to the crawl/scoring pipeline. Revisit once the deterministic pipeline and real outreach are proven; only add browser infrastructure if screenshots turn out to matter for conversion.
- **Booking detection**: new `booking_detection` check, cautious language distinguishing "not detected" from "does not exist" — the finding summary must read as "no booking system detected on the sampled pages," never "this business has no booking system."
- **Broken-image detection**: samples image `src` URLs (strict limit, reusing the existing `target-policy` SSRF protections and the crawler's existing internal-link sampling cap) and checks for failed responses.
- **Copyright-year staleness**: extracts a four-digit year near "©"/"copyright" text in the footer/page text; stale (more than 1 year behind the current year) is a WARNING-level, low-severity signal only — it never drives more than 2 points per the scoring table above.
- **Phone/email detection split**: replaces the combined `contact_signals` regex with two independent checks, `phone_detection` and `email_detection`.

## Outreach sent flow

Marking an `OutreachDraft` as sent:
1. Sets `status = SENT`, `sentAt = now()`, and snapshots the exact `sentSubject`/`sentBody` that was sent (independent of the editable working copy, which may be edited or reset afterward without affecting the historical record).
2. Sets `Prospect.lastContactedAt = now()`.
3. Creates a `ProspectActivity` row (`type: OUTREACH_SENT`).
4. Moves `Prospect.pipelineStage` to `CONTACTED` only if its current stage is `NEW` (strictly earlier than `CONTACTED` in the fixed sequence). Never regresses `INTERESTED`, `PROPOSAL`, `WON`, or `LOST`.
5. Surfaces a one-click "Create follow-up task" action in the UI immediately after — never auto-created. Its suggested due date defaults to a configurable business-day interval (5, matching the original spec), computed in the existing fixed `America/New_York` product timezone consistent with M5's task-timezone handling. Declining the suggestion creates nothing.

This preserves M5's explicit principle that tasks are always the result of deliberate owner action.

## Testing

Tests prioritize:
- identical audit inputs producing identical scores (pure function, no AI, no non-determinism)
- category caps binding correctly (e.g., all accessibility+SEO checks failing still caps well below a competitive tier)
- negative modifiers correctly reducing a category's points, floored at zero
- booking-weight multiplier applying only for appointment-driven business categories
- conflicting positive and negative signals resolving correctly within one category
- disqualifiers short-circuiting scoring/recommendations entirely
- category-score calculation independent of the cross-category cap
- top-reason ordering (descending by point contribution, capped at 5)
- recommendation weight summation, threshold, top-2 cap, and confidence derivation
- AI interpretation layer's structured output validated against its schema and rejected if it introduces a number not present in its input
- each new audit check independently, using the existing audit-engine test conventions (mocked crawl results, no live network)
- the no-op `ScreenshotProvider` always returns `unavailable` and never fails or blocks the audit
- outreach sent flow: status/timestamp/snapshot persistence, `lastContactedAt` update, `ProspectActivity` creation, stage advancement only from `NEW`, no regression from `INTERESTED`/`PROPOSAL`/`WON`/`LOST`
- follow-up task suggestion is never auto-created, and its default due date lands on a real business day 5 business days out in the fixed timezone

## Acceptance

Run the complete workflow against at least one real public business website: create a prospect, run an audit, confirm evidence-backed findings including the four new checks and an "unavailable" screenshot result, generate a deterministic opportunity analysis, confirm the score/tier/breakdown/recommendations are traceable to specific check keys, generate outreach from the top recommendation, edit it, mark it sent, confirm `lastContactedAt`/activity/stage-advance behavior, and accept or decline the follow-up-task suggestion. Report findings, any false positives, the full score breakdown, the recommendations produced, the generated outreach, and any remaining reliability issues.

## Non-goals

No Gmail integration, no email sending, no sequences, no Maps/discovery scraping, no AI calling businesses, no billing, no proposals, no invoices, no additional reports, no dashboard redesign, no new CRM pages, no mobile app, no public SaaS onboarding, no background job queue, no automated outreach of any kind.

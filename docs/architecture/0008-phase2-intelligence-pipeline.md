# ADR 0008: Phase 2 website intelligence pipeline

Status: Accepted

Date: 2026-08-05

## Context

M3 scored opportunities and M4 drafted outreach entirely through a single AI call: the model read minimized audit evidence and produced both the score and the prose in one structured response. That design meant the same audit could produce a different score on every regeneration, that "why is this prospect scored this way" was answerable only by re-reading a model's free-text rationale, and that a full 0-100 score with five category breakdowns was float in a single non-deterministic call with no evidentiary trace back to the specific checks that drove it.

Phase 2 (M6 in implementation order, following the M0-M5 milestones already documented) replaces that design with a deterministic scoring and recommendation engine and narrows the AI's role to interpretation and copywriting over an already-computed result. It also closes five gaps identified during M2/M3 review: five missing audit checks, a manual business-category signal, a screenshot placeholder, and an outreach-sent/activity model that M4 never built.

## Decision

### Deterministic scoring replaces AI scoring

`apps/app/app/lib/opportunity/scoring.ts`'s `computeOpportunityScore` is a pure function: identical `ScoringInput` always produces identical `ScoringResult`. Reproducibility and traceability were the driving requirements — the same audit must always produce the same score, and every point on the scoreboard must trace back to a specific check key rather than a paragraph of AI-generated rationale. Each `AuditFinding` maps to a fixed point value in `scoring-rules.ts`'s `POINT_TABLE` (WARNING and FAIL values per check), summed per category, capped per category (`CATEGORY_CAPS`), and normalized to a 0-100 `categoryScores` reading independent of that cap (`CATEGORY_MAX_POSSIBLE`). A small set of `NEGATIVE_MODIFIERS` gives partial credit back when strong existing implementations are detected (e.g. contact path + phone + email all passing), floored at zero per category. `overallScore` is the sum of capped category contributions, mapped to one of four tiers (`EXCELLENT`/`HIGH`/`MEDIUM`/`LOW`). `topReasons` orders the highest point-contributing findings (capped at 5) with their evidence attached, so every score is auditable down to the check that produced it.

Two disqualifiers — `AUDIT_INCOMPLETE` (no pages audited) and `SITE_UNREACHABLE` (every `http_status` check failed) — short-circuit scoring to a `LOW` tier, zero score, and empty breakdown rather than producing a misleading number from absent or unreachable evidence.

`apps/app/app/lib/opportunity/recommend.ts`'s `selectRecommendations` mirrors the same determinism for service recommendations: a fixed `SIGNAL_RULES` table maps specific check/status combinations to weighted `ServiceCategory` candidates, a `RECOMMENDATION_THRESHOLD` of 3 decides which candidates qualify (falling back to the single highest-weighted candidate when nothing clears the bar), and results are capped at two recommendations sorted by weight. An `AFTER_HOURS_COMBINATION` rule specifically combines a failed `booking_detection` with a failed `phone_detection` or `email_detection` into a `LEAD_RESPONSE_AUTOMATION` signal, since neither gap alone captures the after-hours-lead-loss story.

### Category-cap mechanism

`CATEGORY_CAPS` bounds how many overall-score points any single category can contribute (e.g. `ACCESSIBILITY: 12`, `SEO: 8`, `TRUST: 50`, `TECHNICAL: 45`). Without this cap, a site with many small accessibility or SEO findings (six or more low-value FAILs) could accumulate enough raw points to reach a competitive tier despite having no trust, technical, or booking problems — cosmetic findings alone would look like a strong sales opportunity. The cap keeps the overall score dominated by the categories that materially predict a willingness to pay for a redesign or fix (trust and technical health), while still letting `categoryScores` show accessibility/SEO problems at full, uncapped severity in their own row for context.

### Business-category-driven weighting

`APPOINTMENT_DRIVEN_CATEGORIES` (salons/spas, medical/dental, fitness, automotive, legal/financial) doubles the weight of a failed `booking_detection` check in both scoring and recommendation selection (`BOOKING_WEIGHT_MULTIPLIER = 2`). A missing booking system matters more for a business whose revenue depends on scheduled appointments than for, say, a restaurant or retailer, so the same underlying finding is weighted differently based on the prospect's declared business.

### `businessCategory` is manual, not inferred

`Prospect.businessCategory` (the `BusinessCategory` enum: `SALON_SPA`, `MEDICAL_DENTAL`, `HOME_SERVICES`, `AUTOMOTIVE`, `FITNESS`, `LEGAL_FINANCIAL`, `RESTAURANT_FOOD`, `RETAIL`, `PROFESSIONAL_SERVICES`, `OTHER`) is a plain optional field the owner sets from a `<select>` on the create and edit prospect forms — the same pattern as the existing pipeline-stage select. Nothing in this phase infers, scrapes, or classifies a business's category automatically from its website or any other signal. Leaving it unset is a valid, supported state: scoring and recommendation selection both treat `businessCategory: null` as "not appointment-driven" rather than failing or guessing. Automated category inference (from site content, industry APIs, or an AI call) remains an explicit non-goal.

### Screenshot capture is deferred behind a no-op interface

`packages/audit-engine/screenshot.ts` defines a `ScreenshotProvider` interface (`capture(url): Promise<ScreenshotResult>`, where `ScreenshotResult` is `{ status: "captured"; url }` or `{ status: "unavailable"; reason }`) and ships exactly one implementation: `noopScreenshotProvider`, which always resolves `{ status: "unavailable", reason: "not_configured" }` and never rejects. `runWebsiteAudit` accepts an optional `screenshotProvider` (defaulting to the no-op) and only attempts capture after a crawl has genuinely succeeded, wrapping the call in try/catch so a throwing provider degrades to `{ status: "unavailable", reason: "capture_failed" }` rather than turning a successful audit into a failed one. `WebsiteAudit.screenshotUrl`/`screenshotStatus` persist the result.

The interface exists now so a real browser-screenshot provider (e.g. a headless-browser service) can be swapped in later without touching the audit engine, scoring, or schema again. The explicit decision for this phase is **not** to stand up that paid browser infrastructure — no headless-browser account, no rendering service, no cost commitment — until the deterministic pipeline itself has been validated against real sites. `screenshotStatus` is stored as a plain string rather than an enum because the eventual real provider's failure `reason` values are open-ended free text not yet enumerable.

### Outreach-sent flow, `ProspectActivity`, and stage advancement

`markOutreachSent(draftId)` (in `apps/app/app/actions/outreach.ts`) is the only path that transitions an `OutreachDraft` from `COMPLETED` to the new `SENT` status. Inside one `$transaction`, scoped to the authenticated owner and to `status: "COMPLETED"` drafts only (a `RUNNING`, `FAILED`, or already-`SENT` draft is rejected with the same safe "not found" error the file already uses elsewhere, so the caller cannot distinguish "wrong owner" from "wrong status" from "does not exist"), it:

- Sets `status: "SENT"`, `sentAt: now`, and snapshots the current working `subject`/`body` into immutable `sentSubject`/`sentBody` columns — separate from the original AI-generated `generatedSubject`/`generatedBody` snapshot from M4, so there are now three distinct copies of the text (as-generated, as-edited/working, as-sent).
- Sets `Prospect.lastContactedAt = now`.
- Creates a `ProspectActivity` row (`type: "OUTREACH_SENT"`, `metadata: { outreachDraftId }`) — the first append-only activity log in the product, intended to grow with future activity types.
- Advances `Prospect.pipelineStage` from `NEW` to `CONTACTED`, but **only** via a conditional `updateMany` gated on `pipelineStage: "NEW"` in the `where` clause. A prospect already at `CONTACTED`, `INTERESTED`, `PROPOSAL`, `WON`, or `LOST` is left untouched — sending outreach to a prospect already further along the pipeline should never silently regress or misrepresent their stage.

Mark-sent is a one-way action: there is no "unsend." The mark-sent UI (`mark-sent-form.tsx`) hides itself once `status` is already `SENT`, displaying the persisted `sentAt`/`sentSubject`/`sentBody` as a read-only historical record, while the underlying working `subject`/`body` fields remain independently editable and resettable for reference — sending a draft does not lock its editable copy.

### Follow-up tasks remain owner-initiated only

Immediately after a successful mark-sent, `follow-up-suggestion.tsx` offers exactly one button: "Create follow-up task," pre-filled with a title (`"Follow up: <businessName>"`) and a due date five business days out in `America/New_York` (via a new `addBusinessDays` helper alongside M5's existing task time helpers). It calls M5's existing `createTask` action directly — Phase 2 adds no new task-creation code path. Declining is simply not clicking it: navigating away creates nothing, and there is no automatic, scheduled, or background task creation anywhere in this phase. This preserves M5's existing invariant that all Tasks are owner-created and owner-scoped; Phase 2 does not introduce any autonomous or AI-initiated task.

### Bounded AI interpretation layer

The AI Gateway call that remains (`generateInterpretation` in `apps/app/app/lib/opportunity/generate.ts`) receives an already-computed score, tier, category breakdown, top reasons, and already-selected recommendation candidates (each with its `serviceCategory` fixed) and is asked only to (a) write plain-language `summary`/`strongestIssue`/`practicalImpact`/`suggestedOffer`/`warnings` prose describing that result, and (b) write a `title`/`rationale`/`action` for each already-selected recommendation. It cannot choose, add, drop, or reorder a service category — `validateInterpretationOutput` enforces set equality between the returned and expected `serviceCategory` values — and it cannot introduce any number not already present in the deterministic input: `buildAllowedNumbers` collects every score, category score, breakdown point value, top-reason point value, and recommendation weight (plus the universal bounds 0/1/2/100) into an allowlist, and any numeric token in the returned prose that isn't in that allowlist fails validation. This keeps the score itself fully deterministic and reproducible while still using the model for what it's good at: turning a structured result into readable, evidence-grounded prose. If the interpretation call fails for any reason (rate limit, timeout, Gateway error, invalid output), the deterministic score/tier/breakdown still persists as a completed analysis — only the recommendation rows and narrative fields are skipped, since there is no fallback copy for the `NOT NULL` `title`/`rationale`/`action` columns.

## Consequences

Scoring and recommendation selection are now fully reproducible and unit-testable without any AI Gateway dependency — `scoring.test.ts` and `recommend.test.ts` cover the point tables, caps, modifiers, and thresholds directly. Every score is traceable to specific check keys via `scoringBreakdown`/`topReasons`, closing the "why did this get this score" gap from M3. The tradeoff is a fixed, hand-maintained point table: adding a new audit check or adjusting a weight requires a deliberate code and test change rather than the AI silently adapting its own weighting, and the tables must be revisited as new categories or checks are added (as `BOOKING` was in this phase). The AI call that remains is smaller, cheaper, and easier to validate, but still carries the same Gateway availability/latency/cost characteristics as before for the prose it does generate.

The `ProspectActivity` table and `lastContactedAt` field give the product its first real "when did the owner last touch this prospect" signal, at the cost of one new manual step (explicitly marking a draft sent) rather than automatically inferring contact from generation or copy actions.

## Non-goals

Phase 2 does not add: automated business-category inference or classification; paid browser/headless-screenshot infrastructure or any screenshot provider beyond the no-op; email sending, delivery, or open tracking; autonomous or scheduled task creation of any kind; a stage-history/audit-log model beyond `ProspectActivity`'s single `OUTREACH_SENT` type; multiple business categories per prospect; re-scoring or auto-refreshing an existing analysis when new checks are added later; CSV import, discovery providers, or bulk audit/analysis/outreach operations; QStash, webhooks, callbacks, or any asynchronous/background job execution; a second application or deployable service; analytics or forecasting dashboards; and any AI-authored score, weight, or numeric claim that did not already exist in the deterministic input.

# LeadForge M3 AI Opportunity Scoring Design

## Goal

M3 converts one completed M2 website audit into an explainable AI opportunity assessment. The owner explicitly starts a paid analysis, receives an overall opportunity score, five category scores, an executive summary, and prioritized evidence-linked recommendations, and can revisit immutable analysis history.

The score measures addressable sales opportunity: a higher score means the stored audit provides stronger evidence of meaningful website problems that LeadForge could help resolve. It does not measure website quality, prospect fit, business value, revenue, or likelihood to close.

## Scope

M3 includes:

- Manual AI analysis of a completed, owner-scoped website audit
- Vercel AI Gateway integration through the AI SDK
- Strict structured generation and server-side validation
- Overall and category opportunity scores from 0–100
- A concise executive summary
- Three to seven prioritized, evidence-linked recommendations
- Immutable analysis attempts and owner-scoped history
- Safe failure persistence and manual retry
- Model, prompt-version, timing, and token-usage metadata
- Focused tests using injected generation fixtures, with no paid test calls
- One Prisma migration, documentation, CI, and the existing single Vercel deployment

M3 excludes:

- Deterministic fallback scores
- Automatic analysis after an audit
- Bulk or scheduled analysis
- Background jobs, QStash, callbacks, retries, or a separate service
- Raw model responses or chain-of-thought storage
- Traffic, revenue, conversion, ranking, legal-compliance, or cost claims
- Outreach generation, email, tasks, deals, pipeline, analytics, or prospect discovery

## Architecture

M3 remains inside `apps/app`. Focused server-only modules own:

- minimizing stored audit data into the model input contract;
- constructing the versioned system/user prompt;
- invoking Vercel AI Gateway through the AI SDK;
- validating structured output and evidence references;
- mapping provider and persistence failures to stable safe codes.

A Server Action owns authentication, allowlisting, audit ownership checks, attempt lifecycle, persistence, logging, revalidation, and redirect behavior. The model integration accepts an injected generator so automated tests never contact AI Gateway.

No `packages/opportunity-engine` package is created in M3 because the existing app is the only consumer. M4 may extract shared AI infrastructure when outreach generation introduces a second use case.

## External Integration

`AI_GATEWAY_MODEL` is required to initiate analysis and contains the complete Gateway model identifier selected by the operator. Application code has no hardcoded production default. Every attempt persists the exact identifier used.

Local development uses `AI_GATEWAY_API_KEY`. Production uses Vercel OIDC when available to the project runtime, with `AI_GATEWAY_API_KEY` as the documented explicit alternative. The README will document exact setup steps but implementation will not provision or change an external account without credentials.

The AI request uses structured generation with a strict schema. The provider request has a fixed timeout and no automatic application-level retry. A failed call remains a visible, manually retryable attempt.

## Data Model

Add these Prisma enums and models:

```prisma
enum OpportunityAnalysisStatus {
  RUNNING
  COMPLETED
  FAILED
}

enum RecommendationLevel {
  HIGH
  MEDIUM
  LOW
}

model OpportunityAnalysis {
  id               String                    @id @default(cuid())
  userId           String
  prospectId       String
  auditId          String
  status           OpportunityAnalysisStatus @default(RUNNING)
  overallScore     Int?
  categoryScores   Json?
  executiveSummary String?
  overallRationale String?
  model             String
  promptVersion     String
  inputTokens       Int?
  outputTokens      Int?
  durationMs        Int?
  failureCode       String?
  failureMessage    String?
  startedAt         DateTime                  @default(now())
  completedAt       DateTime?
  createdAt         DateTime                  @default(now())
  recommendations  OpportunityRecommendation[]

  @@index([userId, createdAt])
  @@index([userId, prospectId, createdAt])
  @@index([userId, auditId, createdAt])
}

model OpportunityRecommendation {
  id             String              @id @default(cuid())
  analysisId     String
  position       Int
  title          String
  impact         RecommendationLevel
  effort         RecommendationLevel
  rationale      String
  action         String
  auditCheckKeys Json
  analysis       OpportunityAnalysis @relation(fields: [analysisId], references: [id], onDelete: Cascade)

  @@unique([analysisId, position])
  @@index([analysisId, impact])
}
```

Completed and failed attempts are immutable. A rerun creates another `OpportunityAnalysis`. The application uses direct `userId`, `prospectId`, and `auditId` predicates for authorization rather than trusting relation traversal or submitted owner data.

`categoryScores` has exactly these integer keys: `accessibility`, `trust`, `seo`, `technical`, and `performance`.

Stable failure codes are `MODEL_NOT_CONFIGURED`, `GATEWAY_ERROR`, `RATE_LIMITED`, `TIMEOUT`, `INVALID_OUTPUT`, and `INTERNAL_ERROR`. `failureMessage` is selected from fixed safe application copy and never contains raw provider or validation output.

## Model Input Boundary

The model receives only:

- prospect business name;
- website hostname without credentials, query, or fragment;
- audit timestamp, crawl coverage, and duration;
- each stored check's key, category, status, summary, and structured evidence.

The model never receives owner email, Clerk identity, prospect contact name/email/phone, location, prospect notes, database IDs, database URLs, or application secrets.

Evidence is serialized through an explicit allowlist of JSON primitive values. Oversized strings are truncated, nested values outside the documented audit evidence contract are discarded, and the complete minimized request is bounded before generation.

## Structured Output Contract

The validated model response is:

```ts
type OpportunityOutput = {
  overallScore: number;
  categoryScores: {
    accessibility: number;
    trust: number;
    seo: number;
    technical: number;
    performance: number;
  };
  executiveSummary: string;
  overallRationale: string;
  recommendations: Array<{
    title: string;
    impact: "HIGH" | "MEDIUM" | "LOW";
    effort: "HIGH" | "MEDIUM" | "LOW";
    rationale: string;
    action: string;
    auditCheckKeys: string[];
  }>;
};
```

Validation requires:

- all six scores are integers from 0 through 100;
- exactly the five named category-score keys are present;
- executive summary is 40–700 characters;
- overall rationale is 40–1,000 characters;
- three through seven recommendations are present;
- title is 5–120 characters;
- recommendation rationale and action are 20–800 characters each;
- impact and effort use only their enums;
- each recommendation references one through five unique audit-check keys;
- every referenced key exists in the source audit;
- duplicate recommendation titles are rejected case-insensitively.

`overallRationale` is used for traceability in the UI but is not chain-of-thought. The prompt requests a short evidence-based explanation, not private reasoning steps. Raw model text, provider payloads, and chain-of-thought are not stored.

## Scoring Contract

Every score measures addressable opportunity:

- 0–19: minimal opportunity
- 20–39: limited opportunity
- 40–59: moderate opportunity
- 60–79: strong opportunity
- 80–100: urgent/high-value opportunity

The five categories correspond to M2 Accessibility, Trust & Conversion, SEO & Discoverability, Technical Health, and Performance Indicators.

The model selects the overall score rather than using a mechanical average. Its overall rationale and recommendations must reference stored audit evidence. Failed checks should normally increase opportunity, warnings may increase it moderately, and passing checks constrain unsupported claims.

The prompt explicitly forbids inventing or estimating traffic, revenue, conversion rates, search rankings, legal compliance, implementation price, customer intent, business size, or guaranteed results. Recommendations describe actions and expected qualitative benefits only.

The result page states that the assessment was AI-generated from a bounded website crawl and is not a comprehensive business valuation.

## Prompt Versioning

Prompt copy and rubric live in a server-only module with a fixed exported version such as `opportunity-v1`. The version changes whenever instructions, rubric, input meaning, or output interpretation changes materially. Formatting-only code changes do not require a new version.

Each attempt snapshots both `model` and `promptVersion`. Rerunning an older audit uses the current configured model and prompt version and creates a new attempt, enabling comparison without rewriting history.

## Application Flow

1. The owner selects Analyze opportunity on a completed audit.
2. The Server Action derives `userId` from Clerk `auth()`, repeats the allowlist check, and loads the audit with `{ id, userId, status: COMPLETED }`, its checks, and its owner-scoped prospect name.
3. It rejects missing configuration or an incomplete/failed/missing/other-owner audit before any model request.
4. It finds any `RUNNING` analysis for the same audit created within five minutes. A recent attempt redirects to its page; an older attempt does not block a rerun.
5. It creates a `RUNNING` analysis containing user, prospect, audit, model, and prompt version.
6. It minimizes audit evidence and invokes the configured Gateway model with the structured schema and fixed timeout.
7. The server validates the response schema plus evidence-key references.
8. One transaction creates ordered recommendations and marks the attempt `COMPLETED` with scores, summary, rationale, tokens, duration, and completion time.
9. Provider, timeout, validation, or persistence failures mark the attempt `FAILED` with a stable safe code/message when possible. No score or partial recommendation is displayed.
10. A stored completed or failed attempt redirects to `/opportunities/[id]`. Pre-attempt failures return an inline action error.

There is no deterministic fallback and no automatic application-level retry.

## Routes and UI

### Navigation

Add `Opportunities` alongside Dashboard, Prospects, Audits, and Settings. No later-milestone navigation is introduced.

### Audit detail

Completed audit pages gain an Opportunity Analysis card with:

- a short explanation that one paid AI call will be made;
- latest analysis status and timestamp when present;
- Analyze opportunity or Analyze again action;
- a real pending state;
- a link to the latest analysis.

Failed or incomplete audits cannot be analyzed and show clear state-specific copy.

### `/opportunities`

Display owner-scoped attempts newest first, paginated at 25. Each completed row shows prospect, domain, overall score, top recommendation, model, and timestamp. Status filtering supports Completed and Failed. Failed attempts appear without a score. Running attempts may appear with an in-progress state. No fake aggregate metrics are added.

### `/opportunities/[id]`

Load with both analysis ID and authenticated user ID; missing and other-owner records return `notFound()`.

A completed page displays:

- overall opportunity score and rubric band;
- five category scores;
- executive summary and concise overall rationale;
- ordered recommendation cards with impact, effort, rationale, action, and linked audit-check evidence;
- source-audit link;
- model, prompt version, token usage when available, and completion time;
- AI/bounded-crawl disclosure;
- Analyze again action.

A failed attempt displays only safe failure copy, source-audit access, and retry. It never renders a fallback or partial score.

## Logging and Privacy

Structured events are:

- `opportunity.analysis.started`
- `opportunity.analysis.succeeded`
- `opportunity.analysis.failed`
- `opportunity.persistence.failed`

Allowed metadata includes user ID, prospect ID, audit ID, analysis ID, model, prompt version, duration, input/output tokens, recommendation count, and safe failure code.

Logs must not include prompts, minimized evidence payloads, model output, prospect contact data or notes, raw URLs with query strings, Clerk data, Gateway credentials, database credentials, or raw validation/provider errors as user-facing copy. The existing logger may serialize the original exception server-side for operational debugging, but structured fields must not duplicate sensitive payloads.

## Error Handling

- `MODEL_NOT_CONFIGURED`: required model or local credential configuration is absent.
- `RATE_LIMITED`: Gateway/provider explicitly reports rate limiting.
- `TIMEOUT`: generation exceeds the configured request deadline.
- `GATEWAY_ERROR`: Gateway/provider request fails otherwise.
- `INVALID_OUTPUT`: structured generation or evidence-reference validation fails.
- `INTERNAL_ERROR`: persistence or an unexpected application failure prevents a valid result.

Failures preserve the source audit. Completed fields remain null on failed attempts. A failed attempt is manually retryable and remains visible in history.

## Testing Strategy

Tests cover LeadForge-owned behavior:

- signed-out and non-allowlisted users cannot analyze;
- incomplete, failed, missing, and other-owner audits are rejected before generation;
- submitted user IDs are ignored;
- minimized input includes only the documented allowlist and strips contact/private data;
- response validation enforces score, length, count, uniqueness, and evidence-reference rules;
- successful output persists recommendations and completed analysis atomically;
- duplicate recent running attempts suppress another model call;
- Gateway, rate-limit, timeout, invalid-output, and database failures store stable safe states;
- no deterministic fallback or partial score is returned after failure;
- list, detail, and latest-analysis queries always include authenticated owner scope;
- reruns create immutable new attempts with the current model and prompt version.

Model integration tests inject a generator fixture. Automated tests never contact AI Gateway or spend tokens. Tests do not merely verify Zod, Prisma, Clerk, the AI SDK, or Gateway behavior.

## Acceptance Flow

1. The allowlisted owner opens a completed audit and explicitly starts analysis.
2. LeadForge sends only minimized audit evidence to the configured Gateway model.
3. A schema-valid response stores an immutable overall score, five category scores, summary, rationale, and three through seven evidence-linked recommendations.
4. The result survives refresh and appears in owner-scoped opportunity history.
5. Rerunning creates a new attempt with its exact model and prompt version.
6. Invalid output, timeout, rate limiting, Gateway failure, or persistence failure displays no score and remains safely retryable.
7. Other users cannot initiate or view the owner's analyses.
8. Automated tests make no paid model calls.
9. `bun run check`, `bun run test`, `bun run build`, and migration deployment pass.
10. The existing single Vercel deployment passes the same manual flow.

## Operational Changes

- Add `AI_GATEWAY_MODEL` to local and Vercel environment examples and validation.
- Add `AI_GATEWAY_API_KEY` to the environment example as an optional local or explicit production credential without committing a value.
- Add the minimum AI SDK/Gateway dependencies needed for structured generation.
- Add and deploy one Prisma migration for analyses and recommendations.
- Document exact local Gateway authentication and Vercel production setup using operator credentials.
- Add no Vercel project, API application, queue, webhook, background worker, or storage integration.

## Deferred Decisions

M4 will design outreach generation using stored opportunity recommendations. Deterministic fallback scoring, prospect-fit scoring, bulk analysis, automatic analysis, comparison dashboards, user-editable weights, provider failover policy, background execution, QStash, and scheduled refreshes remain deferred until product usage justifies them.

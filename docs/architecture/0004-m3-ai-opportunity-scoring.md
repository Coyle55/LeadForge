# ADR 0004: AI-led opportunity scoring

Status: Accepted  
Date: 2026-08-04

## Context

M2 produces deterministic website evidence but deliberately does not rank sales opportunity or prescribe work. M3 needs to turn a completed, owner-scoped audit into a concise sales assessment while keeping model failures explicit and the evidence trail inspectable.

## Decision

- Run analysis manually from a completed audit. The authenticated server action re-reads that audit with both `auditId` and the Clerk `userId`; no submitted owner ID is accepted.
- Use the Vercel AI SDK with an AI Gateway model string supplied by `AI_GATEWAY_MODEL`. No model is silently selected in code.
- Send a minimized snapshot: business name, hostname, audit metadata, and primitive check evidence. Clerk data, contact details, notes, and unrelated database fields are excluded.
- Require structured output: one 0–100 opportunity score, five 0–100 category scores, an executive summary, rationale, and three to seven recommendations tied to real audit check keys.
- Interpret a higher score as more addressable sales opportunity, not higher website quality.
- Store every attempt as an immutable `OpportunityAnalysis`. Successful attempts store their ordered recommendations, model, prompt version, token usage, and duration. Failed attempts store a safe failure code/message and no fallback score.
- Keep execution synchronous and owner-triggered in `apps/app`. A separate callback service, QStash, retries, and scheduled analysis remain deferred.

## Reliability and privacy

The model request uses a 30-second timeout and disables SDK retries so a click cannot create hidden duplicate paid calls. A recent running attempt suppresses double submission. Output is validated against strict bounds and may reference only check keys present in the source audit. Logs contain identifiers, timing, token counts, and failure classifications—not prompts or generated content.

## Consequences

The owner receives evidence-linked prioritization and preserved analysis history. Application use and M2 audits remain fully functional without AI configuration; only the Analyze opportunity action requires `AI_GATEWAY_MODEL` and valid AI Gateway authentication. Failed analyses can be inspected and retried manually from the source audit.

## Non-goals

M3 does not add outreach generation, autonomous actions, background queues, webhooks, screenshots, storage, prospect discovery, tasks, deals, analytics, or another deployable service.

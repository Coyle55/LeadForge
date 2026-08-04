# ADR 0003: Bounded Website Audit Foundation

- Status: Accepted
- Date: 2026-08-04

## Context

M2 must prove that a stored prospect can produce repeatable website evidence. A browser fleet, queue, screenshots, AI interpretation, and a second deployment would obscure that proof with operational concerns.

## Decision

LeadForge isolates crawling and deterministic evaluation in `@repo/audit-engine`. The package has no Clerk, Prisma, Next.js, or React dependencies. The existing application authenticates the owner, verifies prospect ownership, invokes the engine synchronously, and atomically persists immutable audit checks.

The crawler accepts only validated public HTTP(S) targets. It rejects credentials and private, loopback, link-local, and reserved addresses; resolves DNS before requests; disables automatic redirects; and validates every redirect target. It respects robots.txt, remains same-origin, reads at most five HTML pages and two megabytes per response, and uses strict request/run deadlines.

Audit results are deterministic pass, warning, and fail findings with structured evidence. They are not an overall opportunity score, Lighthouse result, Core Web Vitals measurement, or AI recommendation.

## Consequences

- The existing single Vercel project remains the only deployment.
- Local and production behavior require no new external account or environment variable.
- Immutable runs preserve historical evidence and make reruns explicit.
- The package contract can later move behind QStash without changing persistence or presentation.
- Synchronous limits intentionally trade crawl depth for a small, verifiable operational footprint.

## Deferred

Opportunity scoring, recommendations, Lighthouse/browser execution, screenshots, blob storage, scheduled audits, asynchronous retries, QStash, callback services, and multi-region workers remain outside M2.

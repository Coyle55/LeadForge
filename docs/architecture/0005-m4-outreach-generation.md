# ADR 0005: Evidence-grounded outreach generation

Status: Accepted

Date: 2026-08-04

## Context

M3 preserves an evidence-linked opportunity analysis and several prioritized recommendations, but it does not turn those recommendations into recipient-ready outreach. M4 needs to help the owner prepare a concise cold-email draft without weakening the source-evidence boundary, losing the original model output, or expanding LeadForge into an email-delivery system.

## Decision

- Generate from exactly one owner-selected recommendation in a completed M3 analysis. Focusing on one recommendation keeps the message concise, bounds the evidence sent to the model, and leaves the sales judgment of what to discuss with the owner.
- Require the owned prospect to have both a contact name and contact email before generation. The name gives the draft a known human recipient, while the email confirms that the owner has identified a usable contact. The email is snapshotted for the private draft workspace but is not sent to the model.
- Require one complete, reusable Outreach Profile per owner. Sender name, company, service, value proposition, and default call to action give the model explicit sender context instead of inviting it to invent credentials or an offer.
- Store every generation attempt as a separate `OutreachDraft`. A successful attempt preserves immutable `generatedSubject` and `generatedBody` values alongside editable `subject` and `body` working values. Editing changes only the working copy; reset restores it from the immutable generation; regeneration creates another history record.
- Keep generation manual and synchronous inside `apps/app`. One click makes one Gateway request with a 30-second timeout and no automatic paid retry. A recent running attempt for the same recommendation suppresses duplicate requests.
- Reuse the existing `AI_GATEWAY_MODEL` setting and AI Gateway authentication introduced for M3. Local development may supply the existing `AI_GATEWAY_API_KEY`; Vercel deployments may use the platform's Gateway authentication. M4 needs no new external account or deployable service.
- Do not send email. M4 creates, validates, saves, edits, resets, and copies plain-text drafts only.

## Generation and authorization boundary

The authenticated server action reloads the completed analysis, selected recommendation, prospect, source audit evidence, and Outreach Profile using the allowlisted Clerk owner ID. It does not accept browser-supplied owner IDs, recipient details, recommendation text, sender configuration, source linkage, or generated copies.

The model receives the recipient's first name, business name, website hostname, the selected recommendation and its referenced audit checks, and the five Outreach Profile values. It does not receive the recipient email, Clerk data, database IDs, prospect notes, unrelated recommendations, or unrelated audit evidence. The structured result must contain exactly one bounded plain-text subject and body.

Missing contact/profile data and missing model configuration fail before a paid request. Gateway, timeout, rate-limit, and invalid-output failures produce a safe failed history record without synthetic email content. Logs retain identifiers, model/prompt metadata, timing, token counts, status, and safe failure codes—not recipient identity, profile content, prompts, or generated text.

## Local and production behavior

Locally, M4 uses the same application and database environment as M3. With `AI_GATEWAY_MODEL` and valid Gateway authentication configured, the owner can generate a draft synchronously from a completed recommendation. If model or authentication configuration is absent or invalid, prospect management, audits, opportunity history, Outreach Profile settings, and existing outreach history continue to work; the generation action returns a safe configuration or Gateway error.

Production remains one Vercel deployment rooted at `apps/app`. Apply the M4 database migration before accepting traffic, retain the existing Gateway model and authentication configuration, and run the same owner-scoped acceptance flow after deployment.

## Consequences

The owner gets an evidence-grounded drafting workspace with preserved provenance, safe editing, reset, and regeneration history. Synchronous execution keeps the operational model simple and makes each paid action explicit, but the owner must wait for a request to finish and retry failures manually. Requiring a known contact and complete sender profile adds deliberate setup before generation.

## Non-goals

M4 does not add email delivery providers, sending, sequences, follow-ups, HTML email, contact discovery, bulk generation, autonomous outreach, delivery/open tracking, unsubscribe management, QStash, webhooks, callbacks, tasks, deals, analytics, or another application/service. Those capabilities require separate product, operational, and compliance decisions.

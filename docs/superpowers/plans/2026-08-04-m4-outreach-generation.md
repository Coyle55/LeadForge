# M4 Outreach Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate, preserve, edit, reset, and copy one evidence-grounded cold-email draft from an owner-selected M3 recommendation.

**Architecture:** Keep M4 inside `apps/app`: owner-scoped server actions reload all trusted context, a focused outreach module minimizes evidence and validates structured AI output, and Prisma stores one profile plus immutable generation snapshots with editable working copies. Reuse the existing configurable Vercel AI Gateway integration with one synchronous request, no paid retries, and no email-delivery service.

**Tech Stack:** Next.js 16 App Router, React 19 server actions, Clerk, Prisma 7 with `@prisma/adapter-pg`, PostgreSQL, Vercel AI SDK 7, Zod 4, Vitest 4, Bun, Biome/Ultracite

## Global Constraints

- Derive the owner ID exclusively from `auth()` and require the Clerk ID allowlist on every mutation.
- Require an owned prospect with both contact name and contact email, a completed owned M3 analysis, one recommendation belonging to that analysis, and a complete owner Outreach Profile before calling AI.
- Never trust browser-submitted owner IDs, recipient data, recommendation content, generated snapshots, profile values, or source linkage.
- Send only the recipient first name, business name, hostname, selected recommendation, its referenced audit evidence, and Outreach Profile values to the model.
- Produce exactly one concise subject and one plain-text body in a consultative voice.
- Preserve generated subject/body permanently; only working subject/body may be edited or reset.
- Regeneration creates a new draft attempt and recent `RUNNING` attempts suppress duplicate paid calls.
- Use `AI_GATEWAY_MODEL`, a 30-second timeout, `maxRetries: 0`, and telemetry with prompt/output recording disabled.
- Logs must exclude recipient identity/email, profile contents, subject/body, prompts, and model responses.
- Failed attempts store safe failure metadata and no synthetic subject/body.
- Do not add sending, sequences, follow-ups, HTML email, tracking, discovery, bulk generation, QStash, webhooks, tasks, deals, analytics, or another service.

---

### Task 1: Outreach persistence and validation contracts

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260805010000_m4_outreach_generation/migration.sql`
- Modify: `packages/validation/index.ts`
- Modify: `packages/validation/index.test.ts`

**Interfaces:**
- Produces: Prisma `OutreachProfile`, `OutreachDraft`, and `OutreachDraftStatus`.
- Produces: `outreachProfileSchema` and `outreachDraftEditSchema` from `@repo/validation`.

- [ ] **Step 1: Write failing validation tests**

Add cases that accept trimmed valid profile/edit values and reject missing fields, malformed recipient-independent content, subject over 120 characters, body over 2,000 characters, and control characters other than newline/tab:

```ts
expect(outreachProfileSchema.safeParse({
  senderName: " Casey ",
  companyName: "LeadForge",
  serviceOffered: "Website conversion improvements",
  valueProposition: "Turn high-intent visits into more qualified inquiries.",
  defaultCta: "Worth a quick reply if this is a priority?",
}).success).toBe(true);

expect(outreachDraftEditSchema.safeParse({
  subject: "Quick thought about Acme's contact flow",
  body: "Hi Jordan,\n\nI noticed…",
}).success).toBe(true);
```

- [ ] **Step 2: Run the validation test and verify RED**

Run: `bun test packages/validation/index.test.ts`  
Expected: FAIL because the outreach schemas are not exported.

- [ ] **Step 3: Add schemas and Prisma models**

Export schemas with these normalized bounds:

```ts
const plainText = (min: number, max: number) =>
  z.string().trim().min(min).max(max).refine(
    (value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value),
    "Unsupported control character"
  );

export const outreachProfileSchema = z.object({
  senderName: plainText(1, 80),
  companyName: plainText(1, 120),
  serviceOffered: plainText(10, 300),
  valueProposition: plainText(20, 600),
  defaultCta: plainText(10, 240),
}).strict();

export const outreachDraftEditSchema = z.object({
  subject: plainText(3, 120),
  body: plainText(40, 2_000),
}).strict();
```

Add `OutreachProfile` with unique `userId`. Add `OutreachDraftStatus { RUNNING COMPLETED FAILED }`. Add `OutreachDraft` with the fields in the approved spec; generated/working/failure fields are nullable because `RUNNING` and `FAILED` attempts contain no email. Add indexes on `[userId, createdAt]`, `[userId, prospectId, createdAt]`, `[userId, analysisId, createdAt]`, and `[userId, recommendationId, createdAt]`. Keep source IDs as scalar snapshots rather than cascading relations so history cannot be erased by future source deletion.

- [ ] **Step 4: Create migration and generate Prisma client**

Run:

```bash
bunx prisma format --schema packages/database/prisma/schema.prisma
cd packages/database && bunx prisma generate
```

Write SQL creating the enum, tables, unique constraint, and indexes with names matching Prisma's generated conventions. Validate it against a shadow/test database through `bun run migrate` when configured; do not alter an already-applied migration.

- [ ] **Step 5: Run tests and schema validation**

Run:

```bash
bun test packages/validation/index.test.ts
cd packages/database && bunx prisma validate
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/database/prisma packages/validation
git commit -m "feat: add outreach persistence contracts"
```

---

### Task 2: Outreach Profile settings

**Files:**
- Create: `apps/app/app/actions/outreach-profile.ts`
- Create: `apps/app/app/actions/outreach-profile.test.ts`
- Create: `apps/app/app/(authenticated)/settings/outreach-profile-form.tsx`
- Modify: `apps/app/app/(authenticated)/settings/page.tsx`

**Interfaces:**
- Consumes: `outreachProfileSchema` and `database.outreachProfile`.
- Produces: `updateOutreachProfile(previousState, formData): Promise<OutreachProfileState>`.
- Produces: `OutreachProfileForm` with initial values loaded by the server page.

- [ ] **Step 1: Write failing action tests**

Mock `auth`, allowlisting, Prisma, logger, and cache revalidation. Prove:

```ts
expect(updateMock).not.toHaveBeenCalled(); // unauthorized
expect(upsertMock).toHaveBeenCalledWith({
  where: { userId: "user_owner" },
  create: { userId: "user_owner", ...validValues },
  update: validValues,
});
```

Include a forged `userId` in `FormData` and assert it is ignored. Assert invalid input and database failures return stable safe messages and do not throw.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `bun test apps/app/app/actions/outreach-profile.test.ts`  
Expected: FAIL because the action module does not exist.

- [ ] **Step 3: Implement the owner-scoped upsert action**

Parse only the five named profile fields, then upsert by authenticated `userId`:

```ts
const values = outreachProfileSchema.safeParse({
  senderName: formData.get("senderName"),
  companyName: formData.get("companyName"),
  serviceOffered: formData.get("serviceOffered"),
  valueProposition: formData.get("valueProposition"),
  defaultCta: formData.get("defaultCta"),
});
```

Log only `userId` and success/failure event name. Revalidate `/settings`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `bun test apps/app/app/actions/outreach-profile.test.ts`  
Expected: all action cases pass.

- [ ] **Step 5: Add the Settings form**

Load the profile with `findUnique({ where: { userId: user.id } })`. Render the existing account form and a separate Outreach Profile card. Use `useActionState`, required fields, matching maximum lengths, accessible labels, success/error text, and no client-side owner identity.

- [ ] **Step 6: Verify UI types and commit**

Run: `bun --filter app typecheck`  
Expected: PASS.

```bash
git add apps/app/app/actions/outreach-profile* apps/app/app/\(authenticated\)/settings
git commit -m "feat: add owner outreach profile settings"
```

---

### Task 3: Minimized outreach input and strict output schema

**Files:**
- Create: `apps/app/app/lib/outreach/types.ts`
- Create: `apps/app/app/lib/outreach/input.ts`
- Create: `apps/app/app/lib/outreach/input.test.ts`
- Create: `apps/app/app/lib/outreach/schema.ts`
- Create: `apps/app/app/lib/outreach/schema.test.ts`

**Interfaces:**
- Produces: `buildOutreachInput(args): OutreachInput`.
- Produces: `outreachOutputSchema` and `validateOutreachOutput(output): OutreachOutput`.
- `OutreachOutput` is `{ subject: string; body: string }`.

- [ ] **Step 1: Write failing input tests**

Build an input containing extra IDs, email addresses, notes, nested evidence, unrelated checks, and long strings. Assert the result equals only:

```ts
{
  recipientFirstName: "Jordan",
  businessName: "Acme",
  hostname: "acme.example",
  recommendation: { title, rationale, action },
  evidence: [{ key, label, status, summary, evidence: { primitive: "value" } }],
  sender: { senderName, companyName, serviceOffered, valueProposition, defaultCta },
}
```

Assert only audit keys listed in `recommendation.auditCheckKeys` survive and nested/object evidence is removed.

- [ ] **Step 2: Run input tests and verify RED**

Run: `bun test apps/app/app/lib/outreach/input.test.ts`  
Expected: FAIL because `input.ts` does not exist.

- [ ] **Step 3: Implement minimized input construction**

Derive the first name from the first non-empty whitespace-delimited segment of `contactName`, derive hostname using `new URL(requestedUrl).hostname`, filter checks through a `Set` of referenced keys, keep only primitive evidence, cap evidence entries at 20, and bound every string according to the spec.

- [ ] **Step 4: Write failing output-schema tests**

Test a valid subject/body plus rejection of extra keys, blank text, overlong text, unsupported control characters, markdown heading/link syntax, and HTML tags. Do not test Zod internals.

- [ ] **Step 5: Run output tests and verify RED**

Run: `bun test apps/app/app/lib/outreach/schema.test.ts`  
Expected: FAIL because `schema.ts` does not exist.

- [ ] **Step 6: Implement and verify the output contract**

Use strict Zod output with subject 3–120 and body 40–2,000 characters. Reject `<tag>`, markdown headings, and markdown links; ordinary punctuation and newline-separated plain text remain valid.

Run:

```bash
bun test apps/app/app/lib/outreach/input.test.ts apps/app/app/lib/outreach/schema.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/app/app/lib/outreach
git commit -m "feat: validate grounded outreach contracts"
```

---

### Task 4: AI outreach generator

**Files:**
- Create: `apps/app/app/lib/outreach/prompt.ts`
- Create: `apps/app/app/lib/outreach/generate.ts`
- Create: `apps/app/app/lib/outreach/generate.test.ts`

**Interfaces:**
- Produces: `OUTREACH_PROMPT_VERSION = "outreach-v1"`.
- Produces: `generateOutreach(input, { model, generate?, now? })` returning output, token counts, and duration.
- Produces: `OutreachGenerationError` with `RATE_LIMITED | TIMEOUT | GATEWAY_ERROR | INVALID_OUTPUT`.

- [ ] **Step 1: Write failing generator tests**

Inject a fake generator and prove it receives:

```ts
{
  model: "openai/example-model",
  output: expect.anything(),
  system: expect.stringContaining("one concrete observation"),
  prompt: JSON.stringify(input),
  temperature: 0,
  maxRetries: 0,
  timeout: 30_000,
  telemetry: { recordInputs: false, recordOutputs: false },
}
```

Assert valid output and usage return correctly. Assert 429, timeout/abort, invalid structured output, and unknown provider errors map to stable typed failures.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `bun test apps/app/app/lib/outreach/generate.test.ts`  
Expected: FAIL because generation files do not exist.

- [ ] **Step 3: Implement prompt and generation adapter**

Use AI SDK 7 `generateText` with `Output.object({ schema: outreachOutputSchema })`. The system prompt must contain all approved prohibitions and explicitly state that the evidence is observational, business impact must be qualified, only one issue may be discussed, and the configured CTA must close the email.

- [ ] **Step 4: Run generator tests and typecheck**

Run:

```bash
bun test apps/app/app/lib/outreach/generate.test.ts
bun --filter app typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/app/app/lib/outreach
git commit -m "feat: generate structured outreach drafts"
```

---

### Task 5: Owner-scoped generation action

**Files:**
- Create: `apps/app/app/actions/outreach.ts`
- Create: `apps/app/app/actions/outreach.test.ts`

**Interfaces:**
- Consumes: `buildOutreachInput`, `generateOutreach`, `OUTREACH_PROMPT_VERSION`.
- Produces: `generateOutreachDraft(recommendationId): Promise<{ status: "error"; message: string; href?: string } | undefined>`.

- [ ] **Step 1: Write failing authorization/readiness tests**

Mock every Prisma boundary separately. Prove the action:

- exits before generation for unauthorized users
- loads the recommendation with its completed analysis and then verifies `analysis.userId`
- loads prospect, audit checks, and profile using authenticated `userId`
- rejects missing contact name with `href: /prospects/<id>`
- rejects missing contact email with the same correction link
- rejects missing profile with `href: /settings`
- ignores any extra browser values because the action accepts only `recommendationId`

- [ ] **Step 2: Run focused tests and verify RED**

Run: `bun test apps/app/app/actions/outreach.test.ts`  
Expected: FAIL because the action does not exist.

- [ ] **Step 3: Implement preflight and duplicate suppression**

Load the recommendation using `findFirst({ where: { id: recommendationId, analysis: { userId, status: "COMPLETED" } }, include: { analysis: true } })`. Then load prospect, source audit with checks, and profile using `userId`. Require `AI_GATEWAY_MODEL`. Redirect to a matching `RUNNING` draft created within five minutes.

- [ ] **Step 4: Add failing lifecycle tests**

Assert a successful attempt:

1. creates `RUNNING` before generator invocation
2. calls `buildOutreachInput` only with server-loaded data
3. updates exactly that draft ID to `COMPLETED`
4. writes generated and working fields identically
5. logs only IDs/model/timing/tokens and redirects to `/outreach/<id>`

Assert typed failures update to `FAILED` with null email fields, safe messages, and redirect. Assert start-write failure prevents model invocation; completion/failure-write errors return `Unable to save outreach draft.`

- [ ] **Step 5: Implement lifecycle and verify GREEN**

Use the existing M3 failure-classification pattern. Revalidate `/outreach`, `/opportunities/<analysisId>`, and `/outreach/<draftId>` without logging content or recipient details.

Run: `bun test apps/app/app/actions/outreach.test.ts`  
Expected: all authorization, readiness, lifecycle, and failure cases pass.

- [ ] **Step 6: Commit**

```bash
git add apps/app/app/actions/outreach.ts apps/app/app/actions/outreach.test.ts
git commit -m "feat: persist owner-scoped outreach generation"
```

---

### Task 6: Draft queries and editing actions

**Files:**
- Create: `apps/app/app/(authenticated)/outreach/queries.ts`
- Create: `apps/app/app/(authenticated)/outreach/queries.test.ts`
- Create: `apps/app/app/actions/outreach-drafts.ts`
- Create: `apps/app/app/actions/outreach-drafts.test.ts`

**Interfaces:**
- Produces: `parseOutreachListParams`, `getOutreachDrafts`, `getOutreachDraftDetail`, and `getOutreachReadiness`.
- Produces: `updateOutreachDraft(previousState, formData)` and `resetOutreachDraft(draftId)`.

- [ ] **Step 1: Write failing query tests**

Assert default `COMPLETED`, normalized `FAILED`, 25-row pagination, and exact owner scopes. Detail must use `findFirst({ where: { id: draftId, userId } })`. Readiness must report `missing_contact`, `missing_profile`, or `ready` from owner-scoped prospect/profile reads.

- [ ] **Step 2: Run query tests and verify RED**

Run: `bun test 'apps/app/app/(authenticated)/outreach/queries.test.ts'`  
Expected: FAIL because queries do not exist.

- [ ] **Step 3: Implement focused queries**

Use `OUTREACH_PAGE_SIZE = 25`, deterministic newest-first ordering, batched prospect-name lookup for history, and no unscoped fallback queries.

- [ ] **Step 4: Write failing edit/reset tests**

For `updateOutreachDraft`, submit forged `userId`, `generatedSubject`, `generatedBody`, `prospectId`, and `recommendationId`; assert Prisma receives only validated `{ subject, body }` with `where: { id: draftId, userId, status: "COMPLETED" }`. Assert safe validation/database errors.

For reset, assert the action loads one completed owner-scoped draft, copies stored `generatedSubject/generatedBody` into `subject/body`, and never accepts replacement generated text from the client.

- [ ] **Step 5: Run action tests and verify RED**

Run: `bun test apps/app/app/actions/outreach-drafts.test.ts`  
Expected: FAIL because edit/reset actions do not exist.

- [ ] **Step 6: Implement edit and reset actions**

Parse `draftId`, `subject`, and `body` only. Return `Draft saved.`, `Draft reset.`, precise validation text, `Not authorized.`, or `Unable to save outreach draft.` Revalidate the detail and history routes. Log only `userId`, `draftId`, action, and error object.

- [ ] **Step 7: Verify and commit**

Run:

```bash
bun test 'apps/app/app/(authenticated)/outreach/queries.test.ts' apps/app/app/actions/outreach-drafts.test.ts
```

Expected: PASS.

```bash
git add 'apps/app/app/(authenticated)/outreach/queries.ts' 'apps/app/app/(authenticated)/outreach/queries.test.ts' apps/app/app/actions/outreach-drafts*
git commit -m "feat: add owner-scoped outreach draft editing"
```

---

### Task 7: Outreach workflow UI

**Files:**
- Create: `apps/app/app/(authenticated)/outreach/page.tsx`
- Create: `apps/app/app/(authenticated)/outreach/[id]/page.tsx`
- Create: `apps/app/app/(authenticated)/outreach/[id]/draft-editor.tsx`
- Create: `apps/app/app/(authenticated)/outreach/generate-button.tsx`
- Modify: `apps/app/app/(authenticated)/opportunities/[id]/page.tsx`
- Modify: `apps/app/app/(authenticated)/layout.tsx`

**Interfaces:**
- Consumes: generation, edit/reset actions and Task 6 queries.
- Produces: `/outreach`, `/outreach/[id]`, recommendation launch controls, and Outreach navigation.

- [ ] **Step 1: Add recommendation readiness and launch controls**

On opportunity detail, compute readiness once for the prospect/profile and render per recommendation:

- ready: `GenerateOutreachButton recommendationId={id}`
- missing contact: link to `/prospects/<prospectId>` with “Add contact name and email”
- missing profile: link to `/settings` with “Complete Outreach Profile”

The client button uses `useTransition`, displays `Drafting…`, and renders returned safe errors/correction links.

- [ ] **Step 2: Add history and navigation**

Add an Outreach nav link. Build `/outreach` using the established opportunity-history visual language, completed/failed filter, 25-item pagination, empty state, recipient/prospect/recommendation context, and status/time.

- [ ] **Step 3: Build the editor**

For completed drafts, render recipient context, immutable source links, subject input, plain-text body textarea, Save, Reset, Copy subject, and Copy body. Implement clipboard buttons locally with `navigator.clipboard.writeText`, temporary `Copied` feedback, and a safe `Copy failed` state. Do not send clipboard values to a server.

Use `useActionState` for Save and `useTransition` for Reset. After reset succeeds, call `router.refresh()` so server-provided defaults match persisted values. Preserve visible unsaved edits until the user explicitly saves or resets.

- [ ] **Step 4: Render failed/running states and metadata**

Failed drafts show only the safe failure message plus source/retry navigation. Running drafts show progress without blank editor fields. Completed metadata shows model, prompt version, duration, and created time; it does not show tokenized prompt or recipient email in logs.

- [ ] **Step 5: Run formatter, typecheck, and focused tests**

Run:

```bash
bun run fix
bun --filter app typecheck
bun test apps/app/app/actions/outreach.test.ts apps/app/app/actions/outreach-drafts.test.ts 'apps/app/app/(authenticated)/outreach/queries.test.ts'
```

Expected: PASS with no formatter changes remaining.

- [ ] **Step 6: Commit**

```bash
git add 'apps/app/app/(authenticated)/outreach' 'apps/app/app/(authenticated)/opportunities/[id]/page.tsx' 'apps/app/app/(authenticated)/layout.tsx'
git commit -m "feat: add outreach drafting workspace"
```

---

### Task 8: Documentation, migration deployment, and acceptance verification

**Files:**
- Create: `docs/architecture/0005-m4-outreach-generation.md`
- Modify: `README.md`

**Interfaces:**
- Documents: M4 decisions, local/production behavior, acceptance flow, and explicit non-goals.

- [ ] **Step 1: Write ADR and README updates**

Record why M4 uses one selected recommendation, requires contact name/email, keeps generated and working copies, remains synchronous, and does not send email. Add `/outreach` routes and the full M4 acceptance flow. State that existing `AI_GATEWAY_MODEL`/Gateway authentication are reused and no new external account is required.

- [ ] **Step 2: Apply the migration to the configured test database**

Run: `bun run migrate:deploy`  
Expected: `20260805010000_m4_outreach_generation` applies successfully. Never print or commit `.env` values.

- [ ] **Step 3: Run fresh repository verification**

Run:

```bash
bun run check
bun run test
SKIP_ENV_VALIDATION=true bun run build
git diff --check
```

Expected: every command exits 0; build output lists `/outreach` and `/outreach/[id]`.

- [ ] **Step 4: Run local browser acceptance**

With `bun dev --filter app` and an authenticated allowlisted owner:

1. save an Outreach Profile
2. confirm a prospect without either contact field is blocked before generation
3. add contact name/email and generate from one completed recommendation
4. confirm the result contains one subject/body and persists after refresh
5. edit/save, refresh, and confirm working-copy persistence
6. reset and confirm the original generation returns after refresh
7. regenerate and confirm a second history record
8. inspect `/outreach` completed/failed filters
9. confirm browser console has no application errors

If Gateway credentials are absent, verify readiness/UI and the safe model-configuration error, then explicitly record the live paid-generation portion as pending owner configuration rather than fabricating success.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md docs/architecture/0005-m4-outreach-generation.md
git commit -m "docs: record M4 outreach generation decisions"
```

- [ ] **Step 6: Review final branch scope**

Run:

```bash
git status --short
git log --oneline main..HEAD
git diff --stat main...HEAD
```

Expected: clean tree and only M4 design, persistence, profile, generation, draft workflow, tests, and documentation changes.

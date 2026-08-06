# Phase 3 AI-Powered Prospect Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an owner search for businesses by type/location, preview AI-discovered candidates with evidence, import only the selected ones, and optionally run the existing audit action sequentially over them — all without a new page, a new AI provider credential, or fake queue semantics.

**Architecture:** A provider-agnostic `ProspectDiscoveryProvider` interface (matching the existing `ScreenshotProvider` precedent) with one implementation, `PerplexityGatewayDiscoveryProvider`, built on the Vercel AI Gateway's built-in `gateway.tools.perplexitySearch()` tool plus an Anthropic reasoning model — both routed through the existing Gateway/OIDC setup, zero new credentials. Search never writes to the database; only import does, idempotently.

**Tech Stack:** Next.js 16 App Router, React 19 Server Components/server actions, Clerk, Prisma 7, PostgreSQL, Zod 4, Vitest 4, Bun, Biome/Ultracite, Vercel AI SDK (`ai` package, `generateText` + `Output.object` + `tools` + `stopWhen: isStepCount(n)`, per the SDK's own tool-calling-with-structured-outputs guidance)

## Global Constraints

- `ProspectDiscoveryInput.businessType` and `.location` are both required, non-empty strings. `resultLimit` is 1-25, default 10 — enforced server-side regardless of client input.
- `DiscoveredProspect.discoveryId` is always locally derived (`normalizeDomain(websiteUrl)` if present, else a hash of `normalizeName(businessName) + normalizeAddress(formattedAddress)`) — never a model-generated value. A provider-native id, if the tool exposes one, is preserved separately as `providerCandidateId`, never used as a dedup/cache key.
- A candidate is rejected only for missing `businessName` or an empty `sourceUrls` array. Missing `websiteUrl` alone makes a candidate valid-but-import-ineligible (`websiteVerified: false`), never silently dropped. One bad candidate never fails the whole search.
- `sourceProvider: "PERPLEXITY_GATEWAY_SEARCH"` — never `"CLAUDE_WEB_SEARCH"`. `reasoningModel` and token usage live on `ProspectImportBatch`/`ProspectDiscoveryCache`, not on `Prospect`.
- Dedup priority, first match wins: domain → `sourceExternalId` → phone → name+address. Runs at preview time AND again inside the import transaction — import is idempotent regardless of stale client state.
- Cache key includes provider, reasoning model, `DISCOVERY_PROMPT_VERSION`, and normalized query params — a prompt/model change must produce a cache miss, not a stale-shaped hit. Only a search with at least one valid candidate is cached; errors and all-rejected responses are never cached.
- Import commits fully before any audit runs. Import+Audit is sequential (one `runProspectAudit` call at a time, awaited), capped at 10 per batch, with visible per-item progress. Never call this a "queue" in code, logs, or UI copy — no background-job system exists in this codebase.
- Owner-scoped throughout: every query/mutation derives `userId` from `auth()`, never from client input.
- No new top-level page — everything extends `/prospects`. No new discovery provider besides Perplexity-via-Gateway. No automatic outreach generation from this flow.

---

### Task 1: Normalization helpers and discovery types

**Files:**
- Create: `apps/app/app/lib/discovery/normalize.ts`
- Create: `apps/app/app/lib/discovery/normalize.test.ts`
- Create: `apps/app/app/lib/discovery/types.ts`

**Interfaces:**
- Produces: `normalizeDomain(url: string): string | null`, `normalizePhone(phone: string): string | null`, `normalizeName(name: string): string`, `normalizeAddress(address: string): string`, `hashIdentity(value: string): string`; `ProspectDiscoveryInput`, `DiscoveredProspect`, `DiscoveryConfidence`, `ProspectDiscoveryResult`, `ProspectDiscoveryProvider` (all as specified in the design doc's "Provider interface" section, copied verbatim).

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import { normalizeAddress, normalizeDomain, normalizeName, normalizePhone } from "./normalize";

describe("normalizeDomain", () => {
  it("strips protocol, www, trailing slash, and path", () => {
    expect(normalizeDomain("https://www.Example.com/plumbing/")).toBe("example.com");
    expect(normalizeDomain("http://example.com")).toBe("example.com");
    expect(normalizeDomain("example.com/about")).toBe("example.com");
  });

  it("returns null for an unparseable value", () => {
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain("not a url")).toBeNull();
  });
});

describe("normalizePhone", () => {
  it("strips formatting to digits only", () => {
    expect(normalizePhone("(513) 555-0142")).toBe("5135550142");
    expect(normalizePhone("+1 513.555.0142")).toBe("15135550142");
  });

  it("returns null for a value with no digits", () => {
    expect(normalizePhone("call us")).toBeNull();
  });
});

describe("normalizeName", () => {
  it("lowercases, collapses whitespace, and strips punctuation", () => {
    expect(normalizeName("  Ace's  Plumbing, Inc.  ")).toBe("aces plumbing inc");
  });
});

describe("normalizeAddress", () => {
  it("lowercases, collapses whitespace, and strips punctuation", () => {
    expect(normalizeAddress("123 Main St., Suite #4, Cincinnati, OH")).toBe(
      "123 main st suite 4 cincinnati oh"
    );
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `bun run test apps/app/app/lib/discovery/normalize.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the normalizers**

```ts
// normalize.ts
export const normalizeDomain = (url: string): string | null => {
  try {
    const parsed = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(url) ? url : `https://${url}`
    );
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
};

export const normalizePhone = (phone: string): string | null => {
  const digits = phone.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
};

const collapseAndStrip = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

export const normalizeName = (name: string): string => collapseAndStrip(name);
export const normalizeAddress = (address: string): string => collapseAndStrip(address);

export const hashIdentity = (value: string): string => {
  // Simple, deterministic, dependency-free string hash (FNV-1a), sufficient
  // for a local identity key -- not a security boundary.
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
};
```

`normalizeDomain("")` and `normalizeDomain("not a url")`: prepending `https://` to `"not a url"` still fails `new URL()` (contains a space), correctly returning `null`; an empty string also throws, returning `null`.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `bun run test apps/app/app/lib/discovery/normalize.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the discovery types**

```ts
// types.ts
export interface ProspectDiscoveryInput {
  businessType: string;
  location: string;
  resultLimit: number;
}

export type DiscoveryConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface DiscoveredProspect {
  category?: string;
  city?: string;
  confidence: DiscoveryConfidence;
  discoveryId: string;
  formattedAddress?: string;
  businessName: string;
  phone?: string;
  providerCandidateId?: string;
  sourceUrls: string[];
  state?: string;
  websiteUrl?: string;
  websiteVerified: boolean;
}

export interface ProspectDiscoveryResult {
  durationMs: number;
  inputTokens?: number;
  location: string;
  outputTokens?: number;
  provider: string;
  query: string;
  reasoningModel: string;
  rejected: Array<{ reason: string }>;
  results: DiscoveredProspect[];
}

export interface ProspectDiscoveryProvider {
  search(input: ProspectDiscoveryInput): Promise<ProspectDiscoveryResult>;
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/app/app/lib/discovery/normalize.ts apps/app/app/lib/discovery/normalize.test.ts apps/app/app/lib/discovery/types.ts
git commit -m "feat: add discovery normalization helpers and provider types"
```

---

### Task 2: Schema changes

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260806010000_phase3_prospect_discovery/migration.sql`

**Interfaces:**
- Produces: `Prospect.sourceProvider`/`sourceExternalId`/`sourceUrls`; new `ProspectImportBatch` and `ProspectDiscoveryCache` models.

- [ ] **Step 1: Add fields and models to schema.prisma**

In `model Prospect`, add: `sourceProvider String?`, `sourceExternalId String?`, `sourceUrls Json?`.

Add:

```prisma
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
  cacheKey     String
  result       Json
  inputTokens  Int?
  outputTokens Int?
  createdAt    DateTime @default(now())

  @@unique([userId, cacheKey])
}
```

- [ ] **Step 2: Format and validate**

```bash
export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 22.12.0
cd packages/database && bunx prisma format && bunx prisma validate && bunx prisma generate
```

- [ ] **Step 3: Write the migration SQL**

```sql
ALTER TABLE "Prospect"
  ADD COLUMN "sourceProvider" TEXT,
  ADD COLUMN "sourceExternalId" TEXT,
  ADD COLUMN "sourceUrls" JSONB;

CREATE TABLE "ProspectImportBatch" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "reasoningModel" TEXT NOT NULL,
  "query" TEXT NOT NULL,
  "location" TEXT NOT NULL,
  "requestedCount" INTEGER NOT NULL,
  "returnedCount" INTEGER NOT NULL,
  "importedCount" INTEGER NOT NULL,
  "skippedCount" INTEGER NOT NULL,
  "failedCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProspectImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProspectImportBatch_userId_createdAt_idx" ON "ProspectImportBatch"("userId", "createdAt");

CREATE TABLE "ProspectDiscoveryCache" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "cacheKey" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "inputTokens" INTEGER,
  "outputTokens" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProspectDiscoveryCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProspectDiscoveryCache_userId_cacheKey_key" ON "ProspectDiscoveryCache"("userId", "cacheKey");
```

Purely additive: no existing column touched, no backfill needed (both new tables start empty).

- [ ] **Step 4: Commit**

```bash
git add packages/database/prisma
git commit -m "feat: add prospect discovery schema"
```

---

### Task 3: Candidate validation and the Perplexity-via-Gateway provider

**Files:**
- Create: `apps/app/app/lib/discovery/schema.ts`
- Create: `apps/app/app/lib/discovery/schema.test.ts`
- Create: `apps/app/app/lib/discovery/prompt.ts`
- Create: `apps/app/app/lib/discovery/generate.ts`
- Create: `apps/app/app/lib/discovery/generate.test.ts`
- Create: `apps/app/app/lib/discovery/perplexity-provider.ts`
- Create: `apps/app/app/lib/discovery/perplexity-provider.test.ts`

**Interfaces:**
- Consumes: `normalizeDomain`, `normalizeName`, `normalizeAddress`, `hashIdentity` (Task 1); `ProspectDiscoveryInput`/`DiscoveredProspect`/`ProspectDiscoveryResult`/`ProspectDiscoveryProvider` (Task 1).
- Produces: `DISCOVERY_PROMPT_VERSION`, `validateCandidate(raw: unknown): { ok: true; value: RawCandidate } | { ok: false; reason: string }`, `deriveDiscoveryId(candidate)`, `generateDiscovery(input, options)`, `PerplexityGatewayDiscoveryProvider` (a class or object implementing `ProspectDiscoveryProvider`).

- [ ] **Step 1: Write failing tests for candidate validation**

```ts
// schema.test.ts
import { describe, expect, it } from "vitest";
import { rawCandidateSchema, validateCandidate } from "./schema";

describe("validateCandidate", () => {
  it("accepts a candidate with only businessName and sourceUrls", () => {
    const result = validateCandidate({
      businessName: "Ace Plumbing",
      sourceUrls: ["https://example.com/listing"],
      confidence: "MEDIUM",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a candidate missing businessName", () => {
    const result = validateCandidate({ sourceUrls: ["https://example.com"], confidence: "LOW" });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("businessName") });
  });

  it("rejects a candidate with empty sourceUrls", () => {
    const result = validateCandidate({
      businessName: "Ace Plumbing",
      sourceUrls: [],
      confidence: "LOW",
    });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("sourceUrls") });
  });

  it("accepts a candidate missing websiteUrl (import-ineligible, not rejected)", () => {
    const result = validateCandidate({
      businessName: "Ace Plumbing",
      sourceUrls: ["https://example.com"],
      confidence: "LOW",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.websiteUrl).toBeUndefined();
    }
  });
});
```

- [ ] **Step 2: Run and verify RED**

Run: `bun run test apps/app/app/lib/discovery/schema.test.ts`

- [ ] **Step 3: Implement `schema.ts`**

```ts
import { z } from "zod";

export const rawCandidateSchema = z.object({
  businessName: z.string().trim().min(1),
  category: z.string().trim().min(1).optional(),
  websiteUrl: z.string().trim().min(1).optional(),
  phone: z.string().trim().min(1).optional(),
  formattedAddress: z.string().trim().min(1).optional(),
  city: z.string().trim().min(1).optional(),
  state: z.string().trim().min(1).optional(),
  sourceUrls: z.array(z.string().trim().min(1)).min(1),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  providerCandidateId: z.string().trim().min(1).optional(),
});
export type RawCandidate = z.infer<typeof rawCandidateSchema>;

export const discoveryModelOutputSchema = z.object({
  candidates: z.array(z.record(z.string(), z.unknown())).max(25),
});

export const validateCandidate = (
  raw: unknown
): { ok: true; value: RawCandidate } | { ok: false; reason: string } => {
  const parsed = rawCandidateSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, reason: `${issue.path.join(".") || "candidate"}: ${issue.message}` };
  }
  return { ok: true, value: parsed.data };
};
```

Note the model's raw output is validated as a loose `z.record` array first (so one malformed candidate's shape doesn't throw the whole `Output.object` parse), then each candidate is individually re-validated through `rawCandidateSchema` via `validateCandidate`.

- [ ] **Step 4: Run and verify GREEN**

Run: `bun run test apps/app/app/lib/discovery/schema.test.ts`

- [ ] **Step 5: Implement the prompt and `DISCOVERY_PROMPT_VERSION`**

```ts
// prompt.ts
export const DISCOVERY_PROMPT_VERSION = "discovery-v1";

export const DISCOVERY_SYSTEM_PROMPT = `You are LeadForge's business discovery assistant. You have access to a web search tool. Use it to find real local businesses matching the requested business type and location.

For each business you report, only include a field if you found it directly in the search results — do not guess, infer, or fabricate a phone number, address, category, website, or business name. If a field is not confidently present in the search results, omit it entirely.

Every business you report MUST include at least one source URL from the actual search results you were given, and a business name. A business with no clear name or no supporting source must not be included at all.

Return between 0 and the requested number of candidates as a JSON object: { "candidates": [...] }. Each candidate may include: businessName, category, websiteUrl, phone, formattedAddress, city, state, sourceUrls (array, at least one), confidence ("HIGH" | "MEDIUM" | "LOW" — how confident you are in the combination of fields reported, based on how directly the search results confirm them), providerCandidateId (only if the search tool exposed a distinct identifier for this result).

Never call the search tool for anything other than the requested business type and location. Do not invent additional businesses beyond what the search actually returned.`;
```

- [ ] **Step 6: Implement `generate.ts`**

```ts
import { generateText, isStepCount, gateway, Output } from "ai";
import { z } from "zod";
import { DISCOVERY_SYSTEM_PROMPT } from "./prompt";
import { discoveryModelOutputSchema } from "./schema";

const timeoutPattern = /timeout|abort/i;
const invalidOutputPattern = /zod|validation/i;

export type DiscoveryGenerationFailure =
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "GATEWAY_ERROR"
  | "INVALID_OUTPUT";

export class DiscoveryGenerationError extends Error {
  readonly code: DiscoveryGenerationFailure;
  constructor(code: DiscoveryGenerationFailure) {
    super(code);
    this.name = "DiscoveryGenerationError";
    this.code = code;
  }
}

interface GenerateResult {
  output: unknown;
  usage: { inputTokens?: number; outputTokens?: number };
}
type Generator = (options: Record<string, unknown>) => Promise<GenerateResult>;

export const generateDiscovery = async (
  input: { businessType: string; location: string; resultLimit: number },
  options: { model: string; generate?: Generator; now?: () => number }
) => {
  const now = options.now ?? Date.now;
  const started = now();
  try {
    const result = await (options.generate ?? (generateText as unknown as Generator))({
      model: options.model,
      system: DISCOVERY_SYSTEM_PROMPT,
      prompt: `Business type: ${input.businessType}\nLocation: ${input.location}\nRequested result count: ${input.resultLimit}`,
      tools: { perplexity_search: gateway.tools.perplexitySearch({ maxResults: 20, country: "US" }) },
      output: Output.object({ schema: discoveryModelOutputSchema }),
      // +1 step beyond the search-call count for the final structured output,
      // per the AI SDK's documented tool-calling-with-structured-outputs pattern.
      stopWhen: isStepCount(4),
      temperature: 0,
      maxRetries: 0,
      timeout: 30_000,
      telemetry: { recordInputs: false, recordOutputs: false },
    });
    const parsed = discoveryModelOutputSchema.parse(result.output);
    return {
      candidates: parsed.candidates,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      durationMs: now() - started,
    };
  } catch (error) {
    if (error instanceof DiscoveryGenerationError) {
      throw error;
    }
    if (typeof error === "object" && error && "statusCode" in error && error.statusCode === 429) {
      throw new DiscoveryGenerationError("RATE_LIMITED");
    }
    if (error instanceof Error && timeoutPattern.test(`${error.name} ${error.message}`)) {
      throw new DiscoveryGenerationError("TIMEOUT");
    }
    if (error instanceof z.ZodError || (error instanceof Error && invalidOutputPattern.test(`${error.name} ${error.message}`))) {
      throw new DiscoveryGenerationError("INVALID_OUTPUT");
    }
    throw new DiscoveryGenerationError("GATEWAY_ERROR");
  }
};
```

Write `generate.test.ts` mirroring the existing `apps/app/app/lib/opportunity/generate.test.ts` structure: a mocked `generate` function returning valid/invalid outputs, asserting the three failure classifications and the success path's field mapping.

- [ ] **Step 7: Write failing tests for the provider (identity derivation + per-candidate filtering)**

```ts
// perplexity-provider.test.ts
import { describe, expect, it, vi } from "vitest";

const generateMock = vi.fn();
vi.mock("./generate", () => ({ generateDiscovery: generateMock }));

describe("PerplexityGatewayDiscoveryProvider", () => {
  it("derives discoveryId from the normalized domain when a website is present", async () => {
    generateMock.mockResolvedValue({
      candidates: [
        {
          businessName: "Ace Plumbing",
          websiteUrl: "https://www.aceplumbing.com/",
          sourceUrls: ["https://example.com/listing"],
          confidence: "HIGH",
        },
      ],
      inputTokens: 10,
      outputTokens: 20,
      durationMs: 5,
    });
    const { PerplexityGatewayDiscoveryProvider } = await import("./perplexity-provider");
    const provider = new PerplexityGatewayDiscoveryProvider({ model: "anthropic/claude-haiku-4.5" });
    const result = await provider.search({ businessType: "plumbers", location: "Cincinnati, OH", resultLimit: 10 });
    expect(result.results[0].discoveryId).toBe("aceplumbing.com");
    expect(result.results[0].websiteVerified).toBe(true);
  });

  it("derives discoveryId from a name+address hash when no website is present", async () => {
    generateMock.mockResolvedValue({
      candidates: [
        {
          businessName: "Ace Plumbing",
          formattedAddress: "123 Main St, Cincinnati, OH",
          sourceUrls: ["https://example.com/listing"],
          confidence: "LOW",
        },
      ],
      inputTokens: 10,
      outputTokens: 20,
      durationMs: 5,
    });
    const { PerplexityGatewayDiscoveryProvider } = await import("./perplexity-provider");
    const provider = new PerplexityGatewayDiscoveryProvider({ model: "anthropic/claude-haiku-4.5" });
    const result = await provider.search({ businessType: "plumbers", location: "Cincinnati, OH", resultLimit: 10 });
    expect(result.results[0].discoveryId).toMatch(/^[0-9a-f]+$/);
    expect(result.results[0].websiteVerified).toBe(false);
  });

  it("rejects an invalid candidate without failing the whole search", async () => {
    generateMock.mockResolvedValue({
      candidates: [
        { businessName: "Ace Plumbing", sourceUrls: ["https://example.com"], confidence: "HIGH" },
        { sourceUrls: ["https://example.com"], confidence: "LOW" }, // missing businessName
      ],
      inputTokens: 10,
      outputTokens: 20,
      durationMs: 5,
    });
    const { PerplexityGatewayDiscoveryProvider } = await import("./perplexity-provider");
    const provider = new PerplexityGatewayDiscoveryProvider({ model: "anthropic/claude-haiku-4.5" });
    const result = await provider.search({ businessType: "plumbers", location: "Cincinnati, OH", resultLimit: 10 });
    expect(result.results).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
  });
});
```

- [ ] **Step 8: Run and verify RED, then implement `perplexity-provider.ts`**

```ts
import { normalizeAddress, normalizeDomain, normalizeName, hashIdentity } from "./normalize";
import { generateDiscovery } from "./generate";
import { validateCandidate } from "./schema";
import type { DiscoveredProspect, ProspectDiscoveryInput, ProspectDiscoveryProvider, ProspectDiscoveryResult } from "./types";

const deriveDiscoveryId = (candidate: { websiteUrl?: string; businessName: string; formattedAddress?: string }): string => {
  const domain = candidate.websiteUrl ? normalizeDomain(candidate.websiteUrl) : null;
  if (domain) {
    return domain;
  }
  return hashIdentity(`${normalizeName(candidate.businessName)}|${normalizeAddress(candidate.formattedAddress ?? "")}`);
};

export class PerplexityGatewayDiscoveryProvider implements ProspectDiscoveryProvider {
  constructor(private readonly options: { model: string }) {}

  async search(input: ProspectDiscoveryInput): Promise<ProspectDiscoveryResult> {
    const generated = await generateDiscovery(input, { model: this.options.model });
    const results: DiscoveredProspect[] = [];
    const rejected: Array<{ reason: string }> = [];

    for (const raw of generated.candidates) {
      const validated = validateCandidate(raw);
      if (!validated.ok) {
        rejected.push({ reason: validated.reason });
        continue;
      }
      const value = validated.value;
      results.push({
        discoveryId: deriveDiscoveryId(value),
        providerCandidateId: value.providerCandidateId,
        businessName: value.businessName,
        category: value.category,
        websiteUrl: value.websiteUrl,
        websiteVerified: Boolean(value.websiteUrl),
        phone: value.phone,
        formattedAddress: value.formattedAddress,
        city: value.city,
        state: value.state,
        sourceUrls: value.sourceUrls,
        confidence: value.confidence,
      });
    }

    return {
      results,
      rejected,
      query: input.businessType,
      location: input.location,
      provider: "PERPLEXITY_GATEWAY_SEARCH",
      reasoningModel: this.options.model,
      durationMs: generated.durationMs,
      inputTokens: generated.inputTokens,
      outputTokens: generated.outputTokens,
    };
  }
}
```

- [ ] **Step 9: Run tests and verify GREEN**

Run: `bun run test apps/app/app/lib/discovery`

- [ ] **Step 10: Commit**

```bash
git add apps/app/app/lib/discovery
git commit -m "feat: add candidate validation and Perplexity-via-Gateway discovery provider"
```

---

### Task 4: Duplicate detection

**Files:**
- Create: `apps/app/app/lib/discovery/duplicates.ts`
- Create: `apps/app/app/lib/discovery/duplicates.test.ts`

**Interfaces:**
- Consumes: `normalizeDomain`, `normalizePhone`, `normalizeName`, `normalizeAddress` (Task 1).
- Produces: `ExistingProspectIdentity` (`{ id: string; domain: string | null; sourceExternalId: string | null; phone: string | null; nameAddressKey: string | null }`), `buildExistingIdentityIndex(prospects): ExistingIdentityIndex`, `findDuplicateProspectId(candidate, index): string | null`.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import { buildExistingIdentityIndex, findDuplicateProspectId } from "./duplicates";

const existing = [
  { id: "p1", websiteUrl: "https://www.aceplumbing.com", phone: "513-555-0100", businessName: "Ace Plumbing", location: "Cincinnati, OH", sourceExternalId: null },
  { id: "p2", websiteUrl: null, phone: null, businessName: "Bob's HVAC", location: "123 Elm St", sourceExternalId: "ext-42" },
];

describe("findDuplicateProspectId", () => {
  const index = buildExistingIdentityIndex(existing);

  it("matches by domain first", () => {
    expect(
      findDuplicateProspectId(
        { websiteUrl: "https://aceplumbing.com/contact", phone: null, businessName: "Different Name", formattedAddress: null, providerCandidateId: null },
        index
      )
    ).toBe("p1");
  });

  it("matches by sourceExternalId when domain does not match", () => {
    expect(
      findDuplicateProspectId(
        { websiteUrl: null, phone: null, businessName: "Different Name", formattedAddress: null, providerCandidateId: "ext-42" },
        index
      )
    ).toBe("p2");
  });

  it("matches by phone when domain and id do not match", () => {
    expect(
      findDuplicateProspectId(
        { websiteUrl: null, phone: "(513) 555-0100", businessName: "Different Name", formattedAddress: null, providerCandidateId: null },
        index
      )
    ).toBe("p1");
  });

  it("matches by name+address when nothing else matches", () => {
    expect(
      findDuplicateProspectId(
        { websiteUrl: null, phone: null, businessName: "Bob's HVAC", formattedAddress: "123 Elm St", providerCandidateId: null },
        index
      )
    ).toBe("p2");
  });

  it("returns null when nothing matches", () => {
    expect(
      findDuplicateProspectId(
        { websiteUrl: "https://totally-different.com", phone: "999", businessName: "New Co", formattedAddress: "999 Nowhere", providerCandidateId: null },
        index
      )
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run and verify RED**

- [ ] **Step 3: Implement `duplicates.ts`**

```ts
import { normalizeAddress, normalizeDomain, normalizeName, normalizePhone } from "./normalize";

interface ExistingProspectRecord {
  businessName: string;
  id: string;
  location: string | null;
  phone: string | null;
  sourceExternalId: string | null;
  websiteUrl: string | null;
}

interface ExistingIdentityIndex {
  byDomain: Map<string, string>;
  byNameAddress: Map<string, string>;
  byPhone: Map<string, string>;
  bySourceExternalId: Map<string, string>;
}

export const buildExistingIdentityIndex = (prospects: ExistingProspectRecord[]): ExistingIdentityIndex => {
  const index: ExistingIdentityIndex = {
    byDomain: new Map(),
    bySourceExternalId: new Map(),
    byPhone: new Map(),
    byNameAddress: new Map(),
  };
  for (const prospect of prospects) {
    const domain = prospect.websiteUrl ? normalizeDomain(prospect.websiteUrl) : null;
    if (domain && !index.byDomain.has(domain)) {
      index.byDomain.set(domain, prospect.id);
    }
    if (prospect.sourceExternalId && !index.bySourceExternalId.has(prospect.sourceExternalId)) {
      index.bySourceExternalId.set(prospect.sourceExternalId, prospect.id);
    }
    const phone = prospect.phone ? normalizePhone(prospect.phone) : null;
    if (phone && !index.byPhone.has(phone)) {
      index.byPhone.set(phone, prospect.id);
    }
    const nameAddressKey = `${normalizeName(prospect.businessName)}|${normalizeAddress(prospect.location ?? "")}`;
    if (!index.byNameAddress.has(nameAddressKey)) {
      index.byNameAddress.set(nameAddressKey, prospect.id);
    }
  }
  return index;
};

export const findDuplicateProspectId = (
  candidate: {
    businessName: string;
    formattedAddress: string | null;
    phone: string | null;
    providerCandidateId: string | null;
    websiteUrl: string | null;
  },
  index: ExistingIdentityIndex
): string | null => {
  const domain = candidate.websiteUrl ? normalizeDomain(candidate.websiteUrl) : null;
  if (domain && index.byDomain.has(domain)) {
    return index.byDomain.get(domain) ?? null;
  }
  if (candidate.providerCandidateId && index.bySourceExternalId.has(candidate.providerCandidateId)) {
    return index.bySourceExternalId.get(candidate.providerCandidateId) ?? null;
  }
  const phone = candidate.phone ? normalizePhone(candidate.phone) : null;
  if (phone && index.byPhone.has(phone)) {
    return index.byPhone.get(phone) ?? null;
  }
  const nameAddressKey = `${normalizeName(candidate.businessName)}|${normalizeAddress(candidate.formattedAddress ?? "")}`;
  return index.byNameAddress.get(nameAddressKey) ?? null;
};
```

`byNameAddress` always has a key (even `""` for both empty), matching the design's "name+address, first match wins" as the final fallback tier — two candidates with genuinely empty name AND address would collide, but `businessName` is always non-empty per Task 3's validation, so this only under-matches on address, never on name.

- [ ] **Step 4: Run tests and verify GREEN**

- [ ] **Step 5: Commit**

```bash
git add apps/app/app/lib/discovery/duplicates.ts apps/app/app/lib/discovery/duplicates.test.ts
git commit -m "feat: add priority-ordered prospect duplicate detection"
```

---

### Task 5: Search server action with caching

**Files:**
- Create: `apps/app/app/actions/discovery.ts`
- Create: `apps/app/app/actions/discovery.test.ts`
- Create: `apps/app/app/lib/discovery/cache-key.ts`
- Create: `apps/app/app/lib/discovery/cache-key.test.ts`

**Interfaces:**
- Consumes: `PerplexityGatewayDiscoveryProvider`, `DiscoveryGenerationError` (Task 3); `buildExistingIdentityIndex`, `findDuplicateProspectId` (Task 4); `DISCOVERY_PROMPT_VERSION` (Task 3).
- Produces: `searchProspects(input: { businessType: string; location: string; resultLimit: number }): Promise<{ status: "success"; result: ProspectDiscoveryResult & { duplicateProspectIds: Record<string, string | null> } } | { status: "error"; message: string }>`.

- [ ] **Step 1: Implement `cache-key.ts`**

```ts
import { hashIdentity, normalizeAddress, normalizeName } from "./normalize";
import { DISCOVERY_PROMPT_VERSION } from "./prompt";

export const buildDiscoveryCacheKey = (params: {
  businessType: string;
  location: string;
  model: string;
  provider: string;
  resultLimit: number;
}): string =>
  hashIdentity(
    [
      params.provider,
      params.model,
      DISCOVERY_PROMPT_VERSION,
      normalizeName(params.businessType),
      normalizeAddress(params.location),
      String(params.resultLimit),
    ].join("|")
  );
```

Write `cache-key.test.ts` proving: identical inputs produce identical keys; changing `businessType`, `location`, `resultLimit`, `model`, or `provider` each changes the key; case/whitespace variance in `businessType`/`location` does NOT change the key (normalized first).

- [ ] **Step 2: Write failing tests for `searchProspects`**

Mirror `apps/app/app/actions/opportunities.test.ts`'s mocking conventions. Cases: rejects unauthenticated/non-owner callers; rejects invalid input (empty businessType/location, resultLimit outside 1-25) with field errors before calling the provider; on a cache hit (existing non-expired `ProspectDiscoveryCache` row for this owner+key), returns the cached result without calling the provider; on a cache miss, calls the provider, and if the result has at least one valid candidate, persists it to the cache; does NOT cache a provider error or a result with zero valid candidates; annotates every result with `duplicateProspectIds[discoveryId]` computed against the owner's current prospects (not cached duplicate state, since dedup must reflect current data even on a cache hit).

- [ ] **Step 3: Implement `searchProspects`**

Follow the existing `opportunities.ts`/`outreach.ts` conventions: `authorize()` helper, safe error messages via a `failureMessages` map keyed by `DiscoveryGenerationFailure`, structured `logger.info`/`logger.error` calls containing only duration/counts/tokens (never the query text or raw output). Flow: authorize → validate input (Zod: `businessType`/`location` non-empty, `resultLimit` integer 1-25) → compute cache key → look up `database.prospectDiscoveryCache.findUnique` scoped to `userId` + `cacheKey`, checking `createdAt` against the configured TTL (env `PROSPECT_DISCOVERY_CACHE_TTL_MINUTES`, default 60) → on a fresh hit, load current prospects and recompute duplicate annotations fresh, return → on a miss, instantiate `new PerplexityGatewayDiscoveryProvider({ model: env.AI_GATEWAY_MODEL })`, call `.search()`, catch `DiscoveryGenerationError` and return a safe error; on success with `results.length > 0`, `database.prospectDiscoveryCache.upsert` (create-or-replace on the unique `[userId, cacheKey]`) with the raw result and token counts; compute and attach duplicate annotations; return.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `bun run test apps/app/app/actions/discovery.test.ts apps/app/app/lib/discovery/cache-key.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/app/app/actions/discovery.ts apps/app/app/actions/discovery.test.ts apps/app/app/lib/discovery/cache-key.ts apps/app/app/lib/discovery/cache-key.test.ts
git commit -m "feat: add cached, owner-scoped prospect discovery search action"
```

---

### Task 6: Import action

**Files:**
- Modify: `apps/app/app/actions/discovery.ts`
- Modify: `apps/app/app/actions/discovery.test.ts`

**Interfaces:**
- Consumes: `findDuplicateProspectId`, `buildExistingIdentityIndex` (Task 4); `prospectSchema` (existing, `packages/validation/prospect.ts`).
- Produces: `importProspects(candidates: DiscoveredProspect[], batchContext: { query: string; location: string; provider: string; reasoningModel: string; requestedCount: number; returnedCount: number }): Promise<{ status: "success"; imported: string[]; skipped: string[]; failed: Array<{ discoveryId: string; reason: string }> } | { status: "error"; message: string }>`.

- [ ] **Step 1: Write failing tests**

Cases: owner-scoped (rejects unauthenticated); re-checks duplicates against current data at import time (a candidate that was NOT a duplicate at preview time but became one since — e.g. manually created in the interim — is skipped, not imported twice); a candidate missing `websiteUrl` is rejected at import time even if the client somehow submitted it (server-side re-enforcement of import eligibility, never trust client-side checkbox state alone); one candidate failing Zod validation doesn't stop the rest of the batch from importing (partial-failure isolation); persists a `ProspectImportBatch` row with accurate counts; each imported `Prospect` has `sourceProvider`/`sourceExternalId`/`sourceUrls`/`pipelineStage: "NEW"` set correctly.

- [ ] **Step 2: Run and verify RED**

- [ ] **Step 3: Implement `importProspects`**

For each candidate, independently (no shared transaction across candidates — one failure must never roll back another's success): re-fetch current owner prospects, rebuild the identity index, re-check `findDuplicateProspectId` — if a match exists, push to `skipped`; else if `!candidate.websiteVerified`, push to `failed` with reason `"Website not verified"`; else `prospectSchema.safeParse` the mapped fields (`businessName`, `websiteUrl`, `phone`, `location: formattedAddress`) — on failure push to `failed` with the Zod message, on success `database.prospect.create` with `sourceProvider`, `sourceExternalId: discoveryId`, `sourceUrls`, `pipelineStage: "NEW"`, push the new id to `imported`. After the loop, `database.prospectImportBatch.create` with the batch context and the three counts. Return the three arrays.

Rebuilding the identity index once before the loop (not per-candidate) is fine for correctness (no candidate in the same batch creates a `Prospect` that a later candidate in the same batch needs to dedup against — cross-batch duplicates within one import are extremely unlikely for a human-curated selection, and the spec's idempotency requirement is about re-imports across separate calls, not within one). Note this assumption in a comment.

- [ ] **Step 4: Run tests and verify GREEN**

- [ ] **Step 5: Commit**

```bash
git add apps/app/app/actions/discovery.ts apps/app/app/actions/discovery.test.ts
git commit -m "feat: add idempotent prospect import action"
```

---

### Task 7: Import + Audit action

**Files:**
- Modify: `apps/app/app/actions/discovery.ts`
- Modify: `apps/app/app/actions/discovery.test.ts`

**Interfaces:**
- Consumes: `importProspects` (Task 6); `runProspectAudit` (existing, `apps/app/app/actions/audits.ts`).
- Produces: `importAndAuditProspects(candidates, batchContext): Promise<{ status: "success"; imported: string[]; skipped: string[]; failed: Array<{ discoveryId: string; reason: string }>; audits: Array<{ prospectId: string; status: "succeeded" | "failed" }> } | { status: "error"; message: string }>`.

- [ ] **Step 1: Write failing tests**

Cases: import runs to completion first — if `importProspects` itself returns an error, no audit is attempted at all; audits only run for prospects that were actually `imported` (never for `skipped`/`failed` ones); capped at 10 — if more than 10 were imported, only the first 10 get audits, the rest are simply absent from the `audits` array (not marked failed — they were never attempted); one audit throwing/failing does not stop the remaining audits from running (sequential, isolated); a failing audit never un-imports its prospect (no rollback of the import).

- [ ] **Step 2: Run and verify RED**

- [ ] **Step 3: Implement `importAndAuditProspects`**

```ts
const MAX_AUDITS_PER_BATCH = 10;

export const importAndAuditProspects = async (
  candidates: DiscoveredProspect[],
  batchContext: ImportBatchContext
) => {
  const imported = await importProspects(candidates, batchContext);
  if (imported.status === "error") {
    return imported;
  }
  const audits: Array<{ prospectId: string; status: "succeeded" | "failed" }> = [];
  for (const prospectId of imported.imported.slice(0, MAX_AUDITS_PER_BATCH)) {
    try {
      const result = await runProspectAudit(prospectId);
      audits.push({ prospectId, status: result ? "failed" : "succeeded" });
    } catch {
      audits.push({ prospectId, status: "failed" });
    }
  }
  return { ...imported, audits };
};
```

`runProspectAudit` returns an `AuditActionError` object on failure or `undefined` on success (it `redirect()`s on success in its real form — for this sequential-loop context, note in a comment that `runProspectAudit` must not `redirect()` when called from this batch path, since a mid-loop redirect would abort the remaining audits; if the existing action always redirects on success, this task must extract a redirect-free variant — check the actual current `runProspectAudit` implementation first and adapt accordingly, escalating if reconciling this turns out to require restructuring the existing action rather than a small extraction.

- [ ] **Step 4: Run tests and verify GREEN**

- [ ] **Step 5: Commit**

```bash
git add apps/app/app/actions/discovery.ts apps/app/app/actions/discovery.test.ts
git commit -m "feat: add sequential capped import-and-audit action"
```

---

### Task 8: Discover modal and preview UI

**Files:**
- Create: `apps/app/app/(authenticated)/prospects/discover-button.tsx`
- Create: `apps/app/app/(authenticated)/prospects/discover-modal.tsx`
- Create: `apps/app/app/(authenticated)/prospects/discover-results.tsx`
- Create: `apps/app/app/(authenticated)/prospects/discover-results.test.tsx`
- Modify: `apps/app/app/(authenticated)/prospects/page.tsx`

**Interfaces:**
- Consumes: `searchProspects`, `importProspects`, `importAndAuditProspects` (Tasks 5-7).
- Produces: no new exported names outside this directory.

- [ ] **Step 1: Read existing conventions first**

Read `apps/app/app/(authenticated)/prospects/list-controls.tsx` and `apps/app/app/(authenticated)/pipeline/move-stage-form.tsx` for this app's existing form-state/`useActionState` and `<select>`/`<input>` styling conventions before building new components — match them exactly rather than introducing a new pattern.

- [ ] **Step 2: Build `discover-button.tsx` + `discover-modal.tsx`**

`discover-button.tsx`: a client component rendering a `Button` that opens the `Dialog` from `@repo/design-system/components/ui/dialog` (already used elsewhere in this design system — confirm via a grep before assuming exact sub-component names). `discover-modal.tsx`: the dialog's content — a form with Business Type (required text input, no default), Location (required text input, default from a constant, e.g. `"Cincinnati, OH"`), Result Limit (number input, min 1, max 25, default 10). On submit, calls `searchProspects` via `useActionState`, and on success renders `discover-results.tsx` with the returned data; on error, shows the safe error message inline.

- [ ] **Step 3: Build `discover-results.tsx`**

A table of candidates: business name, category, website (or "Official website not verified" badge when `!websiteVerified`), phone, address, confidence badge, source links (rendered as a small list of `<a>` tags), and a status column showing "Already Imported" when `duplicateProspectIds[discoveryId]` is set. Each eligible row (has a verified website AND is not already imported) gets a checkbox; ineligible rows show a disabled checkbox with a tooltip/label explaining why. "Select All" only selects eligible rows. Two submit buttons, "Import Selected" and "Import + Audit Selected", calling `importProspects`/`importAndAuditProspects` respectively with the selected candidates. After either completes, render the returned imported/skipped/failed (and, for the audit path, per-audit) counts/status inline — this is what `ProspectImportBatch` powers, read directly from the action's return value, not a separate query.

Extract the "is this candidate eligible" check into a small pure exported function (e.g. `isImportEligible(candidate, duplicateProspectIds)`), and write `discover-results.test.ts` covering it directly — following the same "pure helpers, not browser internals" testing convention used throughout this codebase (e.g. M5's `task-status-button-state.ts`).

- [ ] **Step 4: Wire into `page.tsx`**

Add `<DiscoverButton />` near the existing `ListControls` in `apps/app/app/(authenticated)/prospects/page.tsx`, without altering the existing list/search/pagination behavior.

- [ ] **Step 5: Run formatter and full verification**

```bash
bun run fix
bun --filter app typecheck
bun run test "apps/app/app/(authenticated)/prospects" apps/app/app/actions/discovery.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add "apps/app/app/(authenticated)/prospects"
git commit -m "feat: add prospect discovery search and import UI"
```

---

### Task 9: Documentation, migration deployment, and acceptance verification

**Files:**
- Create: `docs/architecture/0009-phase3-prospect-discovery.md`
- Modify: `README.md`

**Interfaces:**
- Documents: why Perplexity-via-Gateway instead of direct Claude web search, per-candidate validation, local identity derivation, cache versioning, and the honest sequential (not queued) import+audit design.

- [ ] **Step 1: Add ADR and README documentation**

Document the architecture decision from the design spec's "Architecture" section verbatim in substance (why not direct Anthropic BYOK, what Gateway tool is used instead, that Claude still does the reasoning/extraction). Add the "Discover Businesses" capability to README's `/prospects` route description (no new route to document, since this extends the existing page).

- [ ] **Step 2: Apply the migration to the configured database**

Run: `bun run migrate:deploy`.
Expected: `20260806010000_phase3_prospect_discovery` applies successfully.

- [ ] **Step 3: Run fresh full verification**

```bash
bun run check
bun run test
bun run build
cd packages/database && bunx prisma validate
cd ../.. && git diff --check
```

- [ ] **Step 4: Run the manual verification checklist**

Follow the design spec's "Manual verification checklist" section exactly (9 steps, from opening the modal through confirming no console errors). Report findings, any false-positive/false-negative dedup cases observed, and any remaining reliability issues.

- [ ] **Step 5: Commit docs and inspect branch**

```bash
git add README.md docs/architecture/0009-phase3-prospect-discovery.md
git commit -m "docs: record phase 3 prospect discovery decisions"
git status --short
git log --oneline codex/phase2-intelligence-pipeline..HEAD
git diff --stat codex/phase2-intelligence-pipeline...HEAD
```

Expected: clean tree; diff includes only Phase 3 discovery/import files and documentation.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoveredProspect } from "../lib/discovery/types";

const authMock = vi.fn();
const cacheFindMock = vi.fn();
const cacheUpsertMock = vi.fn();
const prospectFindManyMock = vi.fn();
const prospectCreateMock = vi.fn();
const prospectImportBatchCreateMock = vi.fn();
const searchMock = vi.fn();
const runAuditForProspectMock = vi.fn();

vi.mock("@repo/auth/server", () => ({ auth: authMock }));
vi.mock("./audits", () => ({ runAuditForProspect: runAuditForProspectMock }));
vi.mock("@repo/auth", () => ({
  isAllowedUserId: (id: string) => id === "user_owner",
}));
vi.mock("@repo/database", () => ({
  database: {
    prospectDiscoveryCache: {
      findUnique: cacheFindMock,
      upsert: cacheUpsertMock,
    },
    prospect: { findMany: prospectFindManyMock, create: prospectCreateMock },
    prospectImportBatch: { create: prospectImportBatchCreateMock },
  },
}));
vi.mock("@repo/observability", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));
// A mutable object so individual tests (e.g. the "model not configured"
// case) can flip a field for just that test without vi.doMock/resetModules
// module-cache gymnastics -- `env` is imported as a live reference to this
// same object.
const envMock: {
  AI_GATEWAY_MODEL: string | undefined;
  PROSPECT_DISCOVERY_CACHE_TTL_MINUTES: number;
} = {
  AI_GATEWAY_MODEL: "anthropic/claude-haiku-4.5",
  PROSPECT_DISCOVERY_CACHE_TTL_MINUTES: 60,
};
vi.mock("../../env", () => ({ env: envMock }));
// Only the provider class is mocked (it performs I/O against the AI
// Gateway); `DiscoveryGenerationError` is imported directly from the real
// `./generate` module in tests below so `error instanceof
// DiscoveryGenerationError` in discovery.ts behaves exactly as it does in
// production.
vi.mock("../lib/discovery/perplexity-provider", () => ({
  // A real (non-arrow) function so `new PerplexityGatewayDiscoveryProvider()`
  // in discovery.ts can invoke it as a constructor -- an arrow function
  // passed to mockImplementation throws "is not a constructor" under `new`.
  PerplexityGatewayDiscoveryProvider: vi
    .fn()
    .mockImplementation(function MockProvider(this: {
      search: typeof searchMock;
    }) {
      this.search = searchMock;
    }),
}));

const validInput = {
  businessType: "plumbers",
  location: "Cincinnati, OH",
  resultLimit: 10,
};

const buildDiscoveryResult = (overrides: Record<string, unknown> = {}) => ({
  results: [
    {
      discoveryId: "aceplumbing.com",
      businessName: "Ace Plumbing",
      websiteUrl: "https://aceplumbing.com",
      websiteVerified: true,
      sourceUrls: ["https://example.com/listing"],
      confidence: "HIGH",
    },
  ],
  rejected: [],
  query: "plumbers",
  location: "Cincinnati, OH",
  provider: "PERPLEXITY_GATEWAY_SEARCH",
  reasoningModel: "anthropic/claude-haiku-4.5",
  durationMs: 500,
  inputTokens: 100,
  outputTokens: 50,
  ...overrides,
});

describe("searchProspects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "user_owner" });
    cacheFindMock.mockResolvedValue(null);
    prospectFindManyMock.mockResolvedValue([]);
    envMock.AI_GATEWAY_MODEL = "anthropic/claude-haiku-4.5";
    envMock.PROSPECT_DISCOVERY_CACHE_TTL_MINUTES = 60;
  });

  it("rejects an unauthenticated caller before touching the cache or provider", async () => {
    authMock.mockResolvedValueOnce({ userId: null });
    const { searchProspects } = await import("./discovery");
    await expect(searchProspects(validInput)).resolves.toMatchObject({
      status: "error",
    });
    expect(cacheFindMock).not.toHaveBeenCalled();
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("rejects a caller who is not an allowed owner", async () => {
    authMock.mockResolvedValueOnce({ userId: "user_other" });
    const { searchProspects } = await import("./discovery");
    await expect(searchProspects(validInput)).resolves.toMatchObject({
      status: "error",
    });
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("rejects empty businessType/location and out-of-range resultLimit with field errors before calling the provider", async () => {
    const { searchProspects } = await import("./discovery");
    const result = await searchProspects({
      businessType: "",
      location: "",
      resultLimit: 0,
    });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.fieldErrors).toHaveProperty("businessType");
      expect(result.fieldErrors).toHaveProperty("location");
      expect(result.fieldErrors).toHaveProperty("resultLimit");
    }
    expect(cacheFindMock).not.toHaveBeenCalled();
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("rejects a resultLimit above 25 with a field error", async () => {
    const { searchProspects } = await import("./discovery");
    const result = await searchProspects({ ...validInput, resultLimit: 26 });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.fieldErrors).toHaveProperty("resultLimit");
    }
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("returns the cached result without calling the provider on a fresh cache hit", async () => {
    const cached = buildDiscoveryResult();
    cacheFindMock.mockResolvedValue({
      result: cached,
      createdAt: new Date(),
      inputTokens: cached.inputTokens,
      outputTokens: cached.outputTokens,
    });
    const { searchProspects } = await import("./discovery");
    const result = await searchProspects(validInput);
    expect(searchMock).not.toHaveBeenCalled();
    expect(cacheUpsertMock).not.toHaveBeenCalled();
    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.result.results).toHaveLength(1);
    }
  });

  it("calls the provider when the cached row is older than the configured TTL", async () => {
    cacheFindMock.mockResolvedValue({
      result: buildDiscoveryResult(),
      createdAt: new Date(Date.now() - 61 * 60 * 1000),
      inputTokens: 100,
      outputTokens: 50,
    });
    searchMock.mockResolvedValue(buildDiscoveryResult());
    const { searchProspects } = await import("./discovery");
    await searchProspects(validInput);
    expect(searchMock).toHaveBeenCalledWith(validInput);
  });

  it("calls the provider on a cache miss and persists a result with at least one candidate", async () => {
    searchMock.mockResolvedValue(buildDiscoveryResult());
    const { searchProspects } = await import("./discovery");
    const result = await searchProspects(validInput);

    expect(searchMock).toHaveBeenCalledWith(validInput);
    expect(cacheUpsertMock).toHaveBeenCalledTimes(1);
    const upsertArgs = cacheUpsertMock.mock.calls[0]?.[0];
    expect(upsertArgs.create).toMatchObject({
      userId: "user_owner",
      inputTokens: 100,
      outputTokens: 50,
    });
    expect(result.status).toBe("success");
  });

  it("does not cache a result with zero valid candidates", async () => {
    searchMock.mockResolvedValue(buildDiscoveryResult({ results: [] }));
    const { searchProspects } = await import("./discovery");
    const result = await searchProspects(validInput);

    expect(cacheUpsertMock).not.toHaveBeenCalled();
    expect(result.status).toBe("success");
  });

  it("does not cache a provider error and returns a safe error message", async () => {
    const { DiscoveryGenerationError } = await import(
      "../lib/discovery/generate"
    );
    searchMock.mockRejectedValue(new DiscoveryGenerationError("RATE_LIMITED"));
    const { searchProspects } = await import("./discovery");
    const result = await searchProspects(validInput);

    expect(result.status).toBe("error");
    expect(cacheUpsertMock).not.toHaveBeenCalled();
  });

  it("annotates every result with a duplicateProspectId computed against current owner prospects", async () => {
    searchMock.mockResolvedValue(buildDiscoveryResult());
    prospectFindManyMock.mockResolvedValue([
      {
        id: "existing_1",
        businessName: "Ace Plumbing",
        websiteUrl: "https://aceplumbing.com",
        phone: null,
        location: null,
        sourceExternalId: null,
      },
    ]);
    const { searchProspects } = await import("./discovery");
    const result = await searchProspects(validInput);

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.result.duplicateProspectIds["aceplumbing.com"]).toBe(
        "existing_1"
      );
    }
  });

  it("recomputes duplicate annotations fresh against current data even on a cache hit, not cached duplicate state", async () => {
    cacheFindMock.mockResolvedValue({
      result: buildDiscoveryResult(),
      createdAt: new Date(),
      inputTokens: 100,
      outputTokens: 50,
    });
    // No matching prospect existed when this was cached, but one exists now.
    prospectFindManyMock.mockResolvedValue([
      {
        id: "existing_new",
        businessName: "Ace Plumbing",
        websiteUrl: "https://aceplumbing.com",
        phone: null,
        location: null,
        sourceExternalId: null,
      },
    ]);
    const { searchProspects } = await import("./discovery");
    const result = await searchProspects(validInput);

    expect(searchMock).not.toHaveBeenCalled();
    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.result.duplicateProspectIds["aceplumbing.com"]).toBe(
        "existing_new"
      );
    }
  });

  it("returns a safe error when the AI Gateway model is not configured", async () => {
    envMock.AI_GATEWAY_MODEL = undefined;
    const { searchProspects } = await import("./discovery");
    const result = await searchProspects(validInput);
    expect(result.status).toBe("error");
    expect(searchMock).not.toHaveBeenCalled();
    expect(cacheFindMock).not.toHaveBeenCalled();
  });
});

const batchContext = {
  query: "plumbers",
  location: "Cincinnati, OH",
  provider: "PERPLEXITY_GATEWAY_SEARCH",
  reasoningModel: "anthropic/claude-haiku-4.5",
  requestedCount: 10,
  returnedCount: 1,
};

const buildCandidate = (
  overrides: Partial<DiscoveredProspect> = {}
): DiscoveredProspect => ({
  discoveryId: "aceplumbing.com",
  businessName: "Ace Plumbing",
  websiteUrl: "https://aceplumbing.com",
  websiteVerified: true,
  sourceUrls: ["https://example.com/listing"],
  confidence: "HIGH",
  formattedAddress: "123 Main St, Cincinnati, OH",
  phone: "555-1234",
  ...overrides,
});

describe("importProspects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "user_owner" });
    prospectFindManyMock.mockResolvedValue([]);
    prospectCreateMock.mockImplementation(
      ({ data }: { data: { businessName: string } }) =>
        Promise.resolve({ id: `new_${data.businessName}` })
    );
    prospectImportBatchCreateMock.mockResolvedValue({ id: "batch_1" });
  });

  it("rejects an unauthenticated caller before touching the database", async () => {
    authMock.mockResolvedValueOnce({ userId: null });
    const { importProspects } = await import("./discovery");
    const result = await importProspects([buildCandidate()], batchContext);
    expect(result.status).toBe("error");
    expect(prospectFindManyMock).not.toHaveBeenCalled();
    expect(prospectCreateMock).not.toHaveBeenCalled();
    expect(prospectImportBatchCreateMock).not.toHaveBeenCalled();
  });

  it("skips a candidate that was not a duplicate at preview time but has since become one", async () => {
    prospectFindManyMock.mockResolvedValue([
      {
        id: "existing_1",
        businessName: "Ace Plumbing",
        websiteUrl: "https://aceplumbing.com",
        phone: null,
        location: null,
        sourceExternalId: null,
      },
    ]);
    const { importProspects } = await import("./discovery");
    const result = await importProspects([buildCandidate()], batchContext);

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.skipped).toEqual(["aceplumbing.com"]);
      expect(result.imported).toEqual([]);
    }
    expect(prospectCreateMock).not.toHaveBeenCalled();
  });

  it("rejects a candidate missing websiteUrl even if the client marked it as verified", async () => {
    const candidate = buildCandidate({
      websiteUrl: undefined,
      websiteVerified: true,
    });
    const { importProspects } = await import("./discovery");
    const result = await importProspects([candidate], batchContext);

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.failed).toEqual([
        { discoveryId: "aceplumbing.com", reason: "Website not verified" },
      ]);
      expect(result.imported).toEqual([]);
    }
    expect(prospectCreateMock).not.toHaveBeenCalled();
  });

  it("rejects a candidate with a whitespace-only websiteUrl even if the client marked it as verified", async () => {
    const candidate = buildCandidate({
      websiteUrl: "   ",
      websiteVerified: true,
    });
    const { importProspects } = await import("./discovery");
    const result = await importProspects([candidate], batchContext);

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.failed).toEqual([
        { discoveryId: "aceplumbing.com", reason: "Website not verified" },
      ]);
      expect(result.imported).toEqual([]);
    }
    expect(prospectCreateMock).not.toHaveBeenCalled();
  });

  it("rejects a candidate whose websiteVerified flag is false", async () => {
    const candidate = buildCandidate({ websiteVerified: false });
    const { importProspects } = await import("./discovery");
    const result = await importProspects([candidate], batchContext);

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.failed).toEqual([
        { discoveryId: "aceplumbing.com", reason: "Website not verified" },
      ]);
    }
    expect(prospectCreateMock).not.toHaveBeenCalled();
  });

  it("isolates a Zod validation failure to one candidate without stopping the rest of the batch", async () => {
    const badCandidate = buildCandidate({
      discoveryId: "toolongname.com",
      businessName: "x".repeat(161),
    });
    const goodCandidate = buildCandidate({
      discoveryId: "goodplumbing.com",
      businessName: "Good Plumbing",
      websiteUrl: "https://goodplumbing.com",
    });
    const { importProspects } = await import("./discovery");
    const result = await importProspects(
      [badCandidate, goodCandidate],
      batchContext
    );

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]?.discoveryId).toBe("toolongname.com");
      expect(result.imported).toEqual(["new_Good Plumbing"]);
    }
    expect(prospectCreateMock).toHaveBeenCalledTimes(1);
  });

  it("isolates a thrown database error to one candidate without stopping the rest of the batch", async () => {
    const throwingCandidate = buildCandidate({
      discoveryId: "throws.com",
      businessName: "Throws Plumbing",
      websiteUrl: "https://throws.com",
    });
    const goodCandidate = buildCandidate({
      discoveryId: "goodplumbing.com",
      businessName: "Good Plumbing",
      websiteUrl: "https://goodplumbing.com",
    });
    prospectCreateMock.mockImplementationOnce(() => {
      throw new Error("database unavailable");
    });
    const { importProspects } = await import("./discovery");
    const result = await importProspects(
      [throwingCandidate, goodCandidate],
      batchContext
    );

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.failed).toEqual([
        { discoveryId: "throws.com", reason: "Unable to save prospect." },
      ]);
      expect(result.imported).toEqual(["new_Good Plumbing"]);
    }
    expect(prospectCreateMock).toHaveBeenCalledTimes(2);
  });

  it("never maps candidate.category onto the fixed-enum businessCategory field", async () => {
    const candidate = buildCandidate({ category: "Plumbing" });
    const { importProspects } = await import("./discovery");
    await importProspects([candidate], batchContext);

    expect(prospectCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ businessCategory: null }),
    });
  });

  it("persists a ProspectImportBatch row with accurate counts", async () => {
    const duplicateCandidate = buildCandidate({
      discoveryId: "dupe.com",
      websiteUrl: "https://dupe.com",
    });
    const failingCandidate = buildCandidate({
      discoveryId: "bad.com",
      businessName: "",
      websiteUrl: "https://bad.com",
    });
    const goodCandidate = buildCandidate({
      discoveryId: "good.com",
      businessName: "Good Plumbing",
      websiteUrl: "https://good.com",
    });
    prospectFindManyMock.mockResolvedValue([
      {
        id: "existing_dupe",
        businessName: "Ace Plumbing",
        websiteUrl: "https://dupe.com",
        phone: null,
        location: null,
        sourceExternalId: null,
      },
    ]);
    const { importProspects } = await import("./discovery");
    const result = await importProspects(
      [duplicateCandidate, failingCandidate, goodCandidate],
      batchContext
    );

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.skipped).toEqual(["dupe.com"]);
      expect(result.failed).toHaveLength(1);
      expect(result.imported).toHaveLength(1);
    }
    expect(prospectImportBatchCreateMock).toHaveBeenCalledTimes(1);
    expect(prospectImportBatchCreateMock).toHaveBeenCalledWith({
      data: {
        userId: "user_owner",
        provider: batchContext.provider,
        reasoningModel: batchContext.reasoningModel,
        query: batchContext.query,
        location: batchContext.location,
        requestedCount: batchContext.requestedCount,
        returnedCount: batchContext.returnedCount,
        importedCount: 1,
        skippedCount: 1,
        failedCount: 1,
      },
    });
  });

  it("sets sourceProvider/sourceExternalId/sourceUrls/pipelineStage correctly on the created prospect", async () => {
    const candidate = buildCandidate();
    const { importProspects } = await import("./discovery");
    await importProspects([candidate], batchContext);

    expect(prospectCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user_owner",
        businessName: "Ace Plumbing",
        sourceProvider: batchContext.provider,
        sourceExternalId: "aceplumbing.com",
        sourceUrls: ["https://example.com/listing"],
        pipelineStage: "NEW",
      }),
    });
  });
});

describe("importAndAuditProspects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "user_owner" });
    prospectFindManyMock.mockResolvedValue([]);
    prospectCreateMock.mockImplementation(
      ({ data }: { data: { businessName: string } }) =>
        Promise.resolve({ id: `new_${data.businessName}` })
    );
    prospectImportBatchCreateMock.mockResolvedValue({ id: "batch_1" });
  });

  it("attempts no audits at all when importProspects itself returns an error", async () => {
    authMock.mockResolvedValueOnce({ userId: null });
    const { importAndAuditProspects } = await import("./discovery");
    const result = await importAndAuditProspects(
      [buildCandidate()],
      batchContext
    );
    expect(result.status).toBe("error");
    expect(runAuditForProspectMock).not.toHaveBeenCalled();
  });

  it("only runs audits for prospects that were actually imported, never for skipped or failed candidates", async () => {
    const duplicateCandidate = buildCandidate({
      discoveryId: "dupe.com",
      websiteUrl: "https://dupe.com",
    });
    const failingCandidate = buildCandidate({
      discoveryId: "bad.com",
      businessName: "",
      websiteUrl: "https://bad.com",
    });
    const goodCandidate = buildCandidate({
      discoveryId: "good.com",
      businessName: "Good Plumbing",
      websiteUrl: "https://good.com",
    });
    prospectFindManyMock.mockResolvedValue([
      {
        id: "existing_dupe",
        businessName: "Ace Plumbing",
        websiteUrl: "https://dupe.com",
        phone: null,
        location: null,
        sourceExternalId: null,
      },
    ]);
    runAuditForProspectMock.mockResolvedValue({
      status: "succeeded",
      auditId: "audit_1",
    });
    const { importAndAuditProspects } = await import("./discovery");
    const result = await importAndAuditProspects(
      [duplicateCandidate, failingCandidate, goodCandidate],
      batchContext
    );
    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.imported).toEqual(["new_Good Plumbing"]);
      expect(result.audits).toEqual([
        { prospectId: "new_Good Plumbing", status: "succeeded" },
      ]);
    }
    expect(runAuditForProspectMock).toHaveBeenCalledTimes(1);
    expect(runAuditForProspectMock).toHaveBeenCalledWith("new_Good Plumbing");
  });

  it("caps audits at the first 10 imported prospects, leaving the rest absent from the audits array rather than marked failed", async () => {
    const candidates = Array.from({ length: 12 }, (_, i) =>
      buildCandidate({
        discoveryId: `biz${i}.com`,
        businessName: `Biz ${i}`,
        websiteUrl: `https://biz${i}.com`,
      })
    );
    runAuditForProspectMock.mockResolvedValue({
      status: "succeeded",
      auditId: "audit_x",
    });
    const { importAndAuditProspects } = await import("./discovery");
    const result = await importAndAuditProspects(candidates, batchContext);
    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.imported).toHaveLength(12);
      expect(result.audits).toHaveLength(10);
    }
    expect(runAuditForProspectMock).toHaveBeenCalledTimes(10);
  });

  it("isolates one throwing audit to its own prospect without stopping the remaining audits in the batch", async () => {
    const candidateA = buildCandidate({
      discoveryId: "a.com",
      businessName: "A Biz",
      websiteUrl: "https://a.com",
    });
    const candidateB = buildCandidate({
      discoveryId: "b.com",
      businessName: "B Biz",
      websiteUrl: "https://b.com",
    });
    runAuditForProspectMock
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ status: "succeeded", auditId: "audit_b" });
    const { importAndAuditProspects } = await import("./discovery");
    const result = await importAndAuditProspects(
      [candidateA, candidateB],
      batchContext
    );
    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.audits).toEqual([
        { prospectId: "new_A Biz", status: "failed" },
        { prospectId: "new_B Biz", status: "succeeded" },
      ]);
    }
    expect(runAuditForProspectMock).toHaveBeenCalledTimes(2);
  });

  it("never un-imports a prospect when its audit fails", async () => {
    const candidate = buildCandidate();
    runAuditForProspectMock.mockRejectedValue(new Error("boom"));
    const { importAndAuditProspects } = await import("./discovery");
    const result = await importAndAuditProspects([candidate], batchContext);
    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.imported).toEqual(["new_Ace Plumbing"]);
      expect(result.audits).toEqual([
        { prospectId: "new_Ace Plumbing", status: "failed" },
      ]);
    }
  });

  it("maps an error outcome from runAuditForProspect to a failed audit status", async () => {
    const candidate = buildCandidate();
    runAuditForProspectMock.mockResolvedValue({
      status: "error",
      message: "nope",
    });
    const { importAndAuditProspects } = await import("./discovery");
    const result = await importAndAuditProspects([candidate], batchContext);
    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.audits).toEqual([
        { prospectId: "new_Ace Plumbing", status: "failed" },
      ]);
    }
  });
});

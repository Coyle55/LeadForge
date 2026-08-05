import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const auditFindMock = vi.fn();
const prospectFindMock = vi.fn();
const analysisFindMock = vi.fn();
const analysisCreateMock = vi.fn();
const analysisUpdateMock = vi.fn();
const recommendationCreateMock = vi.fn();
const transactionMock = vi.fn();
const generateMock = vi.fn();
const redirectMock = vi.fn();

vi.mock("@repo/auth/server", () => ({ auth: authMock }));
vi.mock("@repo/auth", () => ({
  isAllowedUserId: (id: string) => id === "user_owner",
}));
vi.mock("@repo/database", () => ({
  database: {
    websiteAudit: { findFirst: auditFindMock },
    prospect: { findFirst: prospectFindMock },
    opportunityAnalysis: {
      findFirst: analysisFindMock,
      create: analysisCreateMock,
      update: analysisUpdateMock,
    },
    opportunityRecommendation: { createMany: recommendationCreateMock },
    $transaction: transactionMock,
  },
}));
vi.mock("@repo/observability", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));
// Only `generateInterpretation` is mocked; `InterpretationGenerationError`
// is re-exported from the real module so `error instanceof
// InterpretationGenerationError` in opportunities.ts behaves exactly as it
// does in production, and tests can throw real instances of it.
vi.mock("../lib/opportunity/generate", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/opportunity/generate")>();
  return { ...actual, generateInterpretation: generateMock };
});
vi.mock("../lib/opportunity/prompt", () => ({
  INTERPRETATION_PROMPT_VERSION: "interpretation-v1",
}));
vi.mock("../../env", () => ({
  env: { AI_GATEWAY_MODEL: "openai/test-model" },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

// One FAIL check that both scoring and recommendation-selection recognize:
// contact_path FAIL contributes 15 TRUST points (scoring-rules.ts) and a
// weight-2 LEAD_CAPTURE_REPAIR signal (recommendation-rules.ts) — below
// RECOMMENDATION_THRESHOLD (3), so selectRecommendations falls back to
// "the single highest-weighted candidate," producing exactly one
// recommendation. This makes both the deterministic score and the
// deterministic recommendation selection real, exercised behavior rather
// than mocked values.
const audit = {
  id: "audit_1",
  userId: "user_owner",
  prospectId: "prospect_1",
  status: "COMPLETED",
  requestedUrl: "https://example.com",
  createdAt: new Date("2026-08-04"),
  pagesAudited: 1,
  pagesAttempted: 1,
  durationMs: 100,
  checks: [
    {
      key: "contact_path",
      category: "TRUST",
      status: "FAIL",
      summary: "Missing",
      evidence: { found: false },
    },
    {
      key: "meta_description",
      category: "ACCESSIBILITY",
      status: "WARNING",
      summary: "Partial",
      evidence: { pages: 2 },
    },
  ],
};

const disqualifiedAudit = {
  ...audit,
  pagesAudited: 0,
  checks: [],
};

const interpretationOutput = {
  summary:
    "This website presents a strong addressable opportunity supported by the failed contact-path check.",
  strongestIssue: "The contact-path check failed, worth 15 points.",
  practicalImpact:
    "Missing contact paths limit clear conversion routes for potential customers.",
  suggestedOffer: "A focused lead-capture repair engagement.",
  confidence: "MEDIUM" as const,
  warnings: [],
  recommendations: [
    {
      serviceCategory: "LEAD_CAPTURE_REPAIR",
      title: "Repair your lead-capture path",
      rationale:
        "The contact-path check failed, which limits clear conversion routes for visitors.",
      action:
        "Add a prominent, working contact action to the header and service pages.",
    },
  ],
};

const generated = {
  output: interpretationOutput,
  inputTokens: 100,
  outputTokens: 80,
  durationMs: 500,
};

describe("analyzeAuditOpportunity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    analysisFindMock.mockResolvedValue(null);
  });

  it("rejects unauthorized and other-owner audits before generation", async () => {
    const { analyzeAuditOpportunity } = await import("./opportunities");
    authMock.mockResolvedValueOnce({ userId: null });
    await expect(analyzeAuditOpportunity("audit_1")).resolves.toMatchObject({
      status: "error",
    });
    authMock.mockResolvedValueOnce({ userId: "user_owner" });
    auditFindMock.mockResolvedValueOnce(null);
    await expect(analyzeAuditOpportunity("audit_other")).resolves.toMatchObject(
      { status: "error" }
    );
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("persists a completed analysis and a recommendation combining AI copy with deterministic fields", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    auditFindMock.mockResolvedValue(audit);
    prospectFindMock.mockResolvedValue({
      businessName: "Acme",
      businessCategory: null,
    });
    analysisCreateMock.mockResolvedValue({ id: "analysis_1" });
    generateMock.mockResolvedValue(generated);
    transactionMock.mockImplementation(async (ops: Promise<unknown>[]) =>
      Promise.all(ops)
    );
    const { analyzeAuditOpportunity } = await import("./opportunities");
    await analyzeAuditOpportunity("audit_1");

    expect(auditFindMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "audit_1", userId: "user_owner", status: "COMPLETED" },
      })
    );
    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedServiceCategories: ["LEAD_CAPTURE_REPAIR"],
        allowedNumbers: expect.arrayContaining([
          "0",
          "1",
          "2",
          "100",
          "15",
          "2",
        ]),
      }),
      { model: "openai/test-model" }
    );
    expect(recommendationCreateMock).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          analysisId: "analysis_1",
          position: 0,
          title: "Repair your lead-capture path",
          rationale:
            "The contact-path check failed, which limits clear conversion routes for visitors.",
          action:
            "Add a prominent, working contact action to the header and service pages.",
          serviceCategory: "LEAD_CAPTURE_REPAIR",
          impact: "LOW",
          effort: "LOW",
          confidence: "LOW",
          auditCheckKeys: ["contact_path"],
        }),
      ],
    });
    expect(analysisUpdateMock).toHaveBeenCalledWith({
      where: { id: "analysis_1" },
      data: expect.objectContaining({
        status: "COMPLETED",
        scoringMethod: "DETERMINISTIC",
        executiveSummary: interpretationOutput.summary,
        overallRationale: interpretationOutput.practicalImpact,
        strongestIssue: interpretationOutput.strongestIssue,
        suggestedOffer: interpretationOutput.suggestedOffer,
        confidence: interpretationOutput.confidence,
        warnings: interpretationOutput.warnings,
      }),
    });
    expect(
      analysisUpdateMock.mock.calls[0]?.[0].data.overallScore
    ).toBeGreaterThan(0);
    expect(transactionMock).toHaveBeenCalled();
    expect(redirectMock).toHaveBeenCalledWith("/opportunities/analysis_1");
  });

  it("persists a disqualified audit as a completed, zero-score analysis with no AI call and no recommendations", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    auditFindMock.mockResolvedValue(disqualifiedAudit);
    prospectFindMock.mockResolvedValue({
      businessName: "Acme",
      businessCategory: null,
    });
    analysisCreateMock.mockResolvedValue({ id: "analysis_1" });
    const { analyzeAuditOpportunity } = await import("./opportunities");
    await analyzeAuditOpportunity("audit_1");

    expect(generateMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
    expect(recommendationCreateMock).not.toHaveBeenCalled();
    expect(analysisUpdateMock).toHaveBeenCalledWith({
      where: { id: "analysis_1" },
      data: expect.objectContaining({
        status: "COMPLETED",
        scoringMethod: "DETERMINISTIC",
        overallScore: 0,
        disqualifiers: ["AUDIT_INCOMPLETE"],
      }),
    });
    expect(redirectMock).toHaveBeenCalledWith("/opportunities/analysis_1");
  });

  it("persists the deterministic score with zero recommendation rows when generateInterpretation fails", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    auditFindMock.mockResolvedValue(audit);
    prospectFindMock.mockResolvedValue({
      businessName: "Acme",
      businessCategory: null,
    });
    analysisCreateMock.mockResolvedValue({ id: "analysis_1" });
    const { InterpretationGenerationError } = await import(
      "../lib/opportunity/generate"
    );
    generateMock.mockRejectedValue(
      new InterpretationGenerationError("INVALID_OUTPUT")
    );
    analysisUpdateMock.mockResolvedValue({});
    const { analyzeAuditOpportunity } = await import("./opportunities");
    await analyzeAuditOpportunity("audit_1");

    expect(recommendationCreateMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
    expect(analysisUpdateMock).toHaveBeenCalledWith({
      where: { id: "analysis_1" },
      data: expect.objectContaining({
        status: "COMPLETED",
        scoringMethod: "DETERMINISTIC",
      }),
    });
    const persisted = analysisUpdateMock.mock.calls[0]?.[0].data;
    expect(persisted.overallScore).toBeGreaterThan(0);
    expect(persisted.strongestIssue).toBeUndefined();
    expect(persisted.suggestedOffer).toBeUndefined();
    expect(persisted.confidence).toBeUndefined();
    expect(persisted.warnings).toBeUndefined();
    expect(persisted.executiveSummary).toBeUndefined();
    expect(persisted.overallRationale).toBeUndefined();
    expect(persisted.status).not.toBe("FAILED");
    expect(redirectMock).toHaveBeenCalledWith("/opportunities/analysis_1");
  });

  it("marks a genuine persistence failure as FAILED, distinct from an interpretation failure", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    auditFindMock.mockResolvedValue(audit);
    prospectFindMock.mockResolvedValue({
      businessName: "Acme",
      businessCategory: null,
    });
    analysisCreateMock.mockResolvedValue({ id: "analysis_1" });
    generateMock.mockResolvedValue(generated);
    transactionMock.mockRejectedValue(new Error("db unavailable"));
    analysisUpdateMock.mockResolvedValue({});
    const { analyzeAuditOpportunity } = await import("./opportunities");
    await analyzeAuditOpportunity("audit_1");

    expect(analysisUpdateMock).toHaveBeenCalledWith({
      where: { id: "analysis_1" },
      data: expect.objectContaining({
        status: "FAILED",
        overallScore: null,
        failureCode: "INTERNAL_ERROR",
      }),
    });
  });
});

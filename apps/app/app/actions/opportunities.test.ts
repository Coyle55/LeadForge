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
vi.mock("../lib/opportunity/generate", () => ({
  generateOpportunity: generateMock,
}));
vi.mock("../lib/opportunity/prompt", () => ({
  OPPORTUNITY_PROMPT_VERSION: "opportunity-v1",
}));
vi.mock("../../env", () => ({
  env: { AI_GATEWAY_MODEL: "openai/test-model" },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

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
      key: "structured_data",
      category: "SEO",
      status: "FAIL",
      summary: "Missing",
      evidence: { blocks: 0 },
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
const generated = {
  output: {
    overallScore: 72,
    categoryScores: {
      accessibility: 60,
      trust: 80,
      seo: 70,
      technical: 75,
      performance: 65,
    },
    executiveSummary:
      "This website presents a strong addressable opportunity supported by several audit findings.",
    overallRationale:
      "Trust and technical findings create the clearest near-term opportunity while several checks already pass.",
    recommendations: [
      {
        title: "Strengthen contact paths",
        impact: "HIGH",
        effort: "LOW",
        rationale:
          "The contact-path check failed and limits clear conversion routes.",
        action:
          "Add a prominent contact action to the header and service pages.",
        auditCheckKeys: ["contact_path"],
      },
      {
        title: "Add structured data",
        impact: "MEDIUM",
        effort: "MEDIUM",
        rationale:
          "The structured-data check indicates no discoverable business schema.",
        action:
          "Publish valid LocalBusiness JSON-LD matching visible business details.",
        auditCheckKeys: ["structured_data"],
      },
      {
        title: "Improve page descriptions",
        impact: "MEDIUM",
        effort: "LOW",
        rationale:
          "Missing descriptions weaken how audited pages communicate their purpose.",
        action:
          "Write unique descriptions for each audited page based on its service intent.",
        auditCheckKeys: ["meta_description"],
      },
    ],
  },
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

  it("persists a completed analysis and ordered recommendations", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    auditFindMock.mockResolvedValue(audit);
    prospectFindMock.mockResolvedValue({ businessName: "Acme" });
    analysisCreateMock.mockResolvedValue({ id: "analysis_1" });
    generateMock.mockResolvedValue(generated);
    transactionMock.mockResolvedValue([]);
    const { analyzeAuditOpportunity } = await import("./opportunities");
    await analyzeAuditOpportunity("audit_1");
    expect(auditFindMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "audit_1", userId: "user_owner", status: "COMPLETED" },
      })
    );
    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prospectName: "Acme",
        hostname: "example.com",
      }),
      { model: "openai/test-model" }
    );
    expect(transactionMock).toHaveBeenCalled();
    expect(redirectMock).toHaveBeenCalledWith("/opportunities/analysis_1");
  });

  it("stores failure without fallback scores", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    auditFindMock.mockResolvedValue(audit);
    prospectFindMock.mockResolvedValue({ businessName: "Acme" });
    analysisCreateMock.mockResolvedValue({ id: "analysis_1" });
    generateMock.mockRejectedValue(
      Object.assign(new Error("safe"), { code: "INVALID_OUTPUT" })
    );
    analysisUpdateMock.mockResolvedValue({});
    const { analyzeAuditOpportunity } = await import("./opportunities");
    await analyzeAuditOpportunity("audit_1");
    expect(analysisUpdateMock).toHaveBeenCalledWith({
      where: { id: "analysis_1" },
      data: expect.objectContaining({
        status: "FAILED",
        overallScore: null,
        failureCode: "INVALID_OUTPUT",
      }),
    });
  });
});

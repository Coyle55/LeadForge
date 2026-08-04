import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const recommendationFindMock = vi.fn();
const prospectFindMock = vi.fn();
const auditFindMock = vi.fn();
const profileFindMock = vi.fn();
const draftFindMock = vi.fn();
const draftCreateMock = vi.fn();
const draftUpdateMock = vi.fn();
const transactionMock = vi.fn();
const transactionQueryMock = vi.fn();
const buildInputMock = vi.fn();
const generateMock = vi.fn();
const redirectMock = vi.fn();
const revalidatePathMock = vi.fn();
const loggerInfoMock = vi.fn();
const loggerErrorMock = vi.fn();
const envMock: { AI_GATEWAY_MODEL?: string } = {
  AI_GATEWAY_MODEL: "openai/test-model",
};

vi.mock("@repo/auth/server", () => ({ auth: authMock }));
vi.mock("@repo/auth", () => ({
  isAllowedUserId: (id: string) => id === "user_owner",
}));
vi.mock("@repo/database", () => ({
  database: {
    $transaction: transactionMock,
    opportunityRecommendation: { findFirst: recommendationFindMock },
    prospect: { findFirst: prospectFindMock },
    websiteAudit: { findFirst: auditFindMock },
    outreachProfile: { findUnique: profileFindMock },
    outreachDraft: {
      findFirst: draftFindMock,
      create: draftCreateMock,
      updateMany: draftUpdateMock,
    },
  },
}));
vi.mock("@repo/observability", () => ({
  logger: { info: loggerInfoMock, error: loggerErrorMock },
}));
vi.mock("../lib/outreach/input", () => ({
  buildOutreachInput: buildInputMock,
}));
vi.mock("../lib/outreach/generate", () => ({
  generateOutreach: generateMock,
  OutreachGenerationError: class OutreachGenerationError extends Error {},
}));
vi.mock("../lib/outreach/prompt", () => ({
  OUTREACH_PROMPT_VERSION: "outreach-v1",
}));
vi.mock("../../env", () => ({ env: envMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

const recommendation = {
  id: "recommendation_1",
  analysisId: "analysis_1",
  position: 0,
  title: "Improve contact paths",
  impact: "HIGH",
  effort: "LOW",
  rationale: "Visitors may not find a clear route to start a conversation.",
  action: "Add a prominent contact action to service pages.",
  auditCheckKeys: ["contact_path"],
  analysis: {
    id: "analysis_1",
    userId: "user_owner",
    prospectId: "prospect_1",
    auditId: "audit_1",
    status: "COMPLETED",
    overallScore: 72,
    categoryScores: {},
    executiveSummary: "A focused opportunity is available.",
    overallRationale: "A contact-path finding supports it.",
    model: "openai/test-model",
    promptVersion: "opportunity-v1",
    inputTokens: 100,
    outputTokens: 80,
    durationMs: 500,
    failureCode: null,
    failureMessage: null,
    startedAt: new Date("2026-08-04T00:00:00.000Z"),
    completedAt: new Date("2026-08-04T00:00:01.000Z"),
    createdAt: new Date("2026-08-04T00:00:00.000Z"),
  },
};

const prospect = {
  id: "prospect_1",
  userId: "user_owner",
  businessName: "Acme",
  websiteUrl: "https://acme.example",
  contactName: "Jordan Smith",
  contactEmail: "jordan@acme.example",
  phone: null,
  location: null,
  notes: "Private prospect note.",
  status: "QUALIFIED",
  createdAt: new Date("2026-08-03T00:00:00.000Z"),
  updatedAt: new Date("2026-08-04T00:00:00.000Z"),
};

const audit = {
  id: "audit_1",
  userId: "user_owner",
  prospectId: "prospect_1",
  requestedUrl: "https://acme.example/services",
  finalUrl: "https://acme.example/services",
  status: "COMPLETED",
  failureCode: null,
  failureMessage: null,
  pagesAttempted: 1,
  pagesAudited: 1,
  durationMs: 100,
  startedAt: new Date("2026-08-04T00:00:00.000Z"),
  completedAt: new Date("2026-08-04T00:00:01.000Z"),
  createdAt: new Date("2026-08-04T00:00:00.000Z"),
  checks: [
    {
      id: "check_1",
      auditId: "audit_1",
      category: "TRUST",
      key: "contact_path",
      label: "Contact paths",
      status: "FAIL",
      summary: "A direct contact path was not found.",
      evidence: { found: false },
    },
  ],
};

const profile = {
  id: "profile_1",
  userId: "user_owner",
  senderName: "Casey",
  companyName: "Northstar Studio",
  serviceOffered: "Website conversion optimization",
  valueProposition:
    "We help service businesses turn clearer websites into better sales conversations.",
  defaultCta: "Would a brief conversation next week be useful?",
  createdAt: new Date("2026-08-04T00:00:00.000Z"),
  updatedAt: new Date("2026-08-04T00:00:00.000Z"),
};

describe("generateOutreachDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envMock.AI_GATEWAY_MODEL = "openai/test-model";
    authMock.mockResolvedValue({ userId: "user_owner" });
    recommendationFindMock.mockResolvedValue(recommendation);
    prospectFindMock.mockResolvedValue(prospect);
    auditFindMock.mockResolvedValue(audit);
    profileFindMock.mockResolvedValue(profile);
    draftFindMock.mockResolvedValue(null);
    draftCreateMock.mockResolvedValue({ id: "draft_1" });
    draftUpdateMock.mockResolvedValue({ count: 1 });
    transactionQueryMock.mockResolvedValue([{ pg_advisory_xact_lock: null }]);
    transactionMock.mockImplementation(async (callback) =>
      callback({
        $queryRaw: transactionQueryMock,
        outreachDraft: {
          create: draftCreateMock,
          findFirst: draftFindMock,
        },
      })
    );
    buildInputMock.mockReturnValue({
      recipientFirstName: "Jordan",
      businessName: "Acme",
      hostname: "acme.example",
      recommendation: {
        title: "Improve contact paths",
        rationale:
          "Visitors may not find a clear route to start a conversation.",
        action: "Add a prominent contact action to service pages.",
      },
      evidence: [
        {
          key: "contact_path",
          label: "Contact paths",
          status: "FAIL",
          summary: "A direct contact path was not found.",
          evidence: { found: false },
        },
      ],
      sender: {
        senderName: "Casey",
        companyName: "Northstar Studio",
        serviceOffered: "Website conversion optimization",
        valueProposition:
          "We help service businesses turn clearer websites into better sales conversations.",
        defaultCta: "Would a brief conversation next week be useful?",
      },
    });
    generateMock.mockResolvedValue({
      output: {
        subject: "A quick thought about Acme",
        body: "Hi Jordan,\n\nI noticed a direct contact path was not found.",
      },
      inputTokens: 100,
      outputTokens: 80,
      durationMs: 500,
    });
  });

  it("rejects an unauthorized caller before reading sources or generating", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { generateOutreachDraft } = await import("./outreach");

    await expect(generateOutreachDraft("recommendation_1")).resolves.toEqual({
      status: "error",
      message: "Not authorized.",
    });

    expect(recommendationFindMock).not.toHaveBeenCalled();
    expect(prospectFindMock).not.toHaveBeenCalled();
    expect(generateMock).not.toHaveBeenCalled();
    expect(draftCreateMock).not.toHaveBeenCalled();
  });

  it("queries a completed owner recommendation and rejects a mismatched included analysis", async () => {
    recommendationFindMock.mockResolvedValue({
      ...recommendation,
      analysis: { ...recommendation.analysis, userId: "user_other" },
    });
    const { generateOutreachDraft } = await import("./outreach");

    await expect(generateOutreachDraft("recommendation_1")).resolves.toEqual({
      status: "error",
      message: "Completed recommendation not found.",
    });

    expect(recommendationFindMock).toHaveBeenCalledWith({
      where: {
        id: "recommendation_1",
        analysis: { userId: "user_owner", status: "COMPLETED" },
      },
      include: { analysis: true },
    });
    expect(prospectFindMock).not.toHaveBeenCalled();
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("returns the prospect correction link before generation when contact name is missing", async () => {
    prospectFindMock.mockResolvedValue({ ...prospect, contactName: null });
    const { generateOutreachDraft } = await import("./outreach");

    await expect(generateOutreachDraft("recommendation_1")).resolves.toEqual({
      status: "error",
      message: "Add a contact name before drafting outreach.",
      href: "/prospects/prospect_1",
    });

    expect(auditFindMock).not.toHaveBeenCalled();
    expect(profileFindMock).not.toHaveBeenCalled();
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("returns the prospect correction link before generation when contact email is missing", async () => {
    prospectFindMock.mockResolvedValue({ ...prospect, contactEmail: null });
    const { generateOutreachDraft } = await import("./outreach");

    await expect(generateOutreachDraft("recommendation_1")).resolves.toEqual({
      status: "error",
      message: "Add a contact email before drafting outreach.",
      href: "/prospects/prospect_1",
    });

    expect(auditFindMock).not.toHaveBeenCalled();
    expect(profileFindMock).not.toHaveBeenCalled();
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("returns the settings correction link before generation when no owner profile exists", async () => {
    profileFindMock.mockResolvedValue(null);
    const { generateOutreachDraft } = await import("./outreach");

    await expect(generateOutreachDraft("recommendation_1")).resolves.toEqual({
      status: "error",
      message: "Complete your outreach profile before drafting outreach.",
      href: "/settings",
    });

    expect(generateMock).not.toHaveBeenCalled();
    expect(draftCreateMock).not.toHaveBeenCalled();
  });

  it("reloads every source under the authenticated owner and ignores extra browser values", async () => {
    envMock.AI_GATEWAY_MODEL = undefined;
    const { generateOutreachDraft } = await import("./outreach");
    const browserValues = {
      userId: "user_other",
      recipientName: "Taylor Other-owner",
      recipientEmail: "taylor@other.example",
      subject: "Injected subject",
      body: "Injected body",
      profile: { senderName: "Injected sender" },
    };

    await expect(
      (
        generateOutreachDraft as unknown as (
          recommendationId: string,
          values: typeof browserValues
        ) => ReturnType<typeof generateOutreachDraft>
      )("recommendation_1", browserValues)
    ).resolves.toEqual({
      status: "error",
      message: "AI Gateway model configuration is required.",
    });

    expect(prospectFindMock).toHaveBeenCalledWith({
      where: { id: "prospect_1", userId: "user_owner" },
    });
    expect(auditFindMock).toHaveBeenCalledWith({
      where: {
        id: "audit_1",
        userId: "user_owner",
        prospectId: "prospect_1",
        status: "COMPLETED",
      },
      include: { checks: true },
    });
    expect(profileFindMock).toHaveBeenCalledWith({
      where: { userId: "user_owner" },
    });
    expect(generateMock).not.toHaveBeenCalled();
    expect(draftCreateMock).not.toHaveBeenCalled();
  });

  it("redirects a recent owner-scoped running draft before another model invocation", async () => {
    draftFindMock.mockResolvedValue({ id: "draft_running" });
    const { generateOutreachDraft } = await import("./outreach");

    await generateOutreachDraft("recommendation_1");

    expect(draftFindMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        userId: "user_owner",
        recommendationId: "recommendation_1",
        status: "RUNNING",
        createdAt: { gte: expect.any(Date) },
      }),
      select: { id: true },
    });
    expect(redirectMock).toHaveBeenCalledWith("/outreach/draft_running");
    expect(draftCreateMock).not.toHaveBeenCalled();
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("serializes concurrent reservations so only one paid generation starts", async () => {
    let activeDraft: { id: string } | null = null;
    let releaseGeneration: (() => void) | undefined;
    const generationCanFinish = new Promise<void>((resolve) => {
      releaseGeneration = resolve;
    });
    draftFindMock.mockImplementation(async () => activeDraft);
    draftCreateMock.mockImplementation(() => {
      activeDraft = { id: "draft_1" };
      return activeDraft;
    });
    generateMock.mockImplementation(async () => {
      await generationCanFinish;
      return {
        output: {
          subject: "A quick thought about Acme",
          body: "Hi Jordan,\n\nI noticed a direct contact path was not found.",
        },
        inputTokens: 100,
        outputTokens: 80,
        durationMs: 500,
      };
    });

    let transactionTail = Promise.resolve<unknown>(undefined);
    transactionMock.mockImplementation((callback) => {
      const result = transactionTail.then(() =>
        callback({
          $queryRaw: transactionQueryMock,
          outreachDraft: {
            create: draftCreateMock,
            findFirst: draftFindMock,
          },
        })
      );
      transactionTail = result.then(
        () => undefined,
        () => undefined
      );
      return result;
    });

    const { generateOutreachDraft } = await import("./outreach");
    const first = generateOutreachDraft("recommendation_1");
    const second = generateOutreachDraft("recommendation_1");

    for (let turn = 0; turn < 20; turn += 1) {
      await Promise.resolve();
    }
    releaseGeneration?.();
    await Promise.all([first, second]);

    expect(redirectMock).toHaveBeenCalledWith("/outreach/draft_1");
    expect(transactionMock).toHaveBeenCalledTimes(2);
    expect(transactionQueryMock).toHaveBeenCalledTimes(2);
    expect(draftCreateMock).toHaveBeenCalledTimes(1);
    expect(generateMock).toHaveBeenCalledTimes(1);
  });

  it("creates a running draft before generation and completes matching immutable and working copies", async () => {
    const events: string[] = [];
    draftCreateMock.mockImplementation(() => {
      events.push("create");
      return { id: "draft_1" };
    });
    generateMock.mockImplementation(() => {
      events.push("generate");
      return {
        output: {
          subject: "A quick thought about Acme",
          body: "Hi Jordan,\n\nI noticed a direct contact path was not found.",
        },
        inputTokens: 100,
        outputTokens: 80,
        durationMs: 500,
      };
    });
    const { generateOutreachDraft } = await import("./outreach");

    await generateOutreachDraft("recommendation_1");

    expect(events).toEqual(["create", "generate"]);
    expect(draftCreateMock).toHaveBeenCalledWith({
      data: {
        userId: "user_owner",
        prospectId: "prospect_1",
        analysisId: "analysis_1",
        recommendationId: "recommendation_1",
        status: "RUNNING",
        recipientName: "Jordan Smith",
        recipientEmail: "jordan@acme.example",
        businessName: "Acme",
        websiteHostname: "acme.example",
        recommendationTitle: "Improve contact paths",
        model: "openai/test-model",
        promptVersion: "outreach-v1",
      },
      select: { id: true },
    });
    expect(buildInputMock).toHaveBeenCalledWith({
      prospect: {
        contactName: "Jordan Smith",
        name: "Acme",
        requestedUrl: "https://acme.example/services",
      },
      recommendation: {
        title: "Improve contact paths",
        rationale:
          "Visitors may not find a clear route to start a conversation.",
        action: "Add a prominent contact action to service pages.",
        auditCheckKeys: ["contact_path"],
      },
      checks: audit.checks,
      sender: {
        senderName: "Casey",
        companyName: "Northstar Studio",
        serviceOffered: "Website conversion optimization",
        valueProposition:
          "We help service businesses turn clearer websites into better sales conversations.",
        defaultCta: "Would a brief conversation next week be useful?",
      },
    });
    expect(generateMock).toHaveBeenCalledWith(
      buildInputMock.mock.results[0]?.value,
      {
        model: "openai/test-model",
      }
    );
    expect(draftUpdateMock).toHaveBeenCalledWith({
      where: { id: "draft_1", status: "RUNNING", userId: "user_owner" },
      data: {
        status: "COMPLETED",
        generatedSubject: "A quick thought about Acme",
        generatedBody:
          "Hi Jordan,\n\nI noticed a direct contact path was not found.",
        subject: "A quick thought about Acme",
        body: "Hi Jordan,\n\nI noticed a direct contact path was not found.",
        inputTokens: 100,
        outputTokens: 80,
        durationMs: 500,
        failureCode: null,
        failureMessage: null,
        completedAt: expect.any(Date),
      },
    });
    expect(loggerInfoMock).toHaveBeenNthCalledWith(
      1,
      "outreach.generation.started",
      {
        userId: "user_owner",
        prospectId: "prospect_1",
        analysisId: "analysis_1",
        recommendationId: "recommendation_1",
        draftId: "draft_1",
        model: "openai/test-model",
        promptVersion: "outreach-v1",
      }
    );
    expect(loggerInfoMock).toHaveBeenNthCalledWith(
      2,
      "outreach.generation.succeeded",
      {
        userId: "user_owner",
        prospectId: "prospect_1",
        analysisId: "analysis_1",
        recommendationId: "recommendation_1",
        draftId: "draft_1",
        model: "openai/test-model",
        promptVersion: "outreach-v1",
        durationMs: 500,
        inputTokens: 100,
        outputTokens: 80,
      }
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/outreach");
    expect(revalidatePathMock).toHaveBeenCalledWith(
      "/opportunities/analysis_1"
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/outreach/draft_1");
    expect(redirectMock).toHaveBeenCalledWith("/outreach/draft_1");
  });

  it("does not invoke the model when the running draft cannot be created", async () => {
    draftCreateMock.mockRejectedValue(new Error("database failure"));
    const { generateOutreachDraft } = await import("./outreach");

    await expect(generateOutreachDraft("recommendation_1")).resolves.toEqual({
      status: "error",
      message: "Unable to start outreach draft.",
    });

    expect(generateMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      "outreach.persistence.failed",
      {
        userId: "user_owner",
        prospectId: "prospect_1",
        analysisId: "analysis_1",
        recommendationId: "recommendation_1",
        model: "openai/test-model",
        promptVersion: "outreach-v1",
      }
    );
  });

  it("persists typed generator failures without generating email fields", async () => {
    generateMock.mockRejectedValue(
      Object.assign(new Error("provider details"), { code: "TIMEOUT" })
    );
    const { generateOutreachDraft } = await import("./outreach");

    await generateOutreachDraft("recommendation_1");

    expect(draftUpdateMock).toHaveBeenCalledWith({
      where: { id: "draft_1", status: "RUNNING", userId: "user_owner" },
      data: {
        status: "FAILED",
        generatedSubject: null,
        generatedBody: null,
        subject: null,
        body: null,
        failureCode: "TIMEOUT",
        failureMessage: "The AI outreach request timed out.",
        completedAt: expect.any(Date),
      },
    });
    expect(loggerErrorMock).toHaveBeenCalledWith("outreach.generation.failed", {
      userId: "user_owner",
      prospectId: "prospect_1",
      analysisId: "analysis_1",
      recommendationId: "recommendation_1",
      draftId: "draft_1",
      model: "openai/test-model",
      promptVersion: "outreach-v1",
      failureCode: "TIMEOUT",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/outreach");
    expect(revalidatePathMock).toHaveBeenCalledWith(
      "/opportunities/analysis_1"
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/outreach/draft_1");
    expect(redirectMock).toHaveBeenCalledWith("/outreach/draft_1");
  });

  it("returns a safe persistence error when the completed draft cannot be saved", async () => {
    draftUpdateMock.mockRejectedValueOnce(new Error("database failure"));
    const { generateOutreachDraft } = await import("./outreach");

    await expect(generateOutreachDraft("recommendation_1")).resolves.toEqual({
      status: "error",
      message: "Unable to save outreach draft.",
    });

    expect(loggerErrorMock).toHaveBeenCalledWith(
      "outreach.persistence.failed",
      {
        userId: "user_owner",
        prospectId: "prospect_1",
        analysisId: "analysis_1",
        recommendationId: "recommendation_1",
        draftId: "draft_1",
        model: "openai/test-model",
        promptVersion: "outreach-v1",
      }
    );
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("refuses to replace a terminal draft or its generated snapshot on completion", async () => {
    draftUpdateMock.mockResolvedValueOnce({ count: 0 });
    const { generateOutreachDraft } = await import("./outreach");

    await expect(generateOutreachDraft("recommendation_1")).resolves.toEqual({
      status: "error",
      message: "Unable to save outreach draft.",
    });

    expect(draftUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "draft_1",
          status: "RUNNING",
          userId: "user_owner",
        },
      })
    );
    expect(loggerInfoMock).not.toHaveBeenCalledWith(
      "outreach.generation.succeeded",
      expect.anything()
    );
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("returns a safe persistence error when the failed draft cannot be saved", async () => {
    generateMock.mockRejectedValue(
      Object.assign(new Error("provider details"), { code: "GATEWAY_ERROR" })
    );
    draftUpdateMock.mockRejectedValueOnce(new Error("database failure"));
    const { generateOutreachDraft } = await import("./outreach");

    await expect(generateOutreachDraft("recommendation_1")).resolves.toEqual({
      status: "error",
      message: "Unable to save outreach draft.",
    });

    expect(loggerErrorMock).toHaveBeenCalledWith(
      "outreach.persistence.failed",
      {
        userId: "user_owner",
        prospectId: "prospect_1",
        analysisId: "analysis_1",
        recommendationId: "recommendation_1",
        draftId: "draft_1",
        model: "openai/test-model",
        promptVersion: "outreach-v1",
        failureCode: "GATEWAY_ERROR",
      }
    );
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("refuses to rewrite a terminal draft with failure metadata", async () => {
    generateMock.mockRejectedValue(
      Object.assign(new Error("provider details"), { code: "TIMEOUT" })
    );
    draftUpdateMock.mockResolvedValueOnce({ count: 0 });
    const { generateOutreachDraft } = await import("./outreach");

    await expect(generateOutreachDraft("recommendation_1")).resolves.toEqual({
      status: "error",
      message: "Unable to save outreach draft.",
    });

    expect(draftUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "draft_1",
          status: "RUNNING",
          userId: "user_owner",
        },
      })
    );
    expect(loggerErrorMock).not.toHaveBeenCalledWith(
      "outreach.generation.failed",
      expect.anything()
    );
    expect(redirectMock).not.toHaveBeenCalled();
  });
});

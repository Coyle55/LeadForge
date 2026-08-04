import { beforeEach, describe, expect, it, vi } from "vitest";

const draftFindManyMock = vi.fn();
const draftCountMock = vi.fn();
const draftFindFirstMock = vi.fn();
const prospectFindManyMock = vi.fn();
const prospectFindFirstMock = vi.fn();
const profileFindUniqueMock = vi.fn();
const recommendationFindFirstMock = vi.fn();
const auditFindFirstMock = vi.fn();

vi.mock("@repo/database", () => ({
  database: {
    outreachDraft: {
      count: draftCountMock,
      findFirst: draftFindFirstMock,
      findMany: draftFindManyMock,
    },
    outreachProfile: { findUnique: profileFindUniqueMock },
    opportunityRecommendation: { findFirst: recommendationFindFirstMock },
    websiteAudit: { findFirst: auditFindFirstMock },
    prospect: {
      findFirst: prospectFindFirstMock,
      findMany: prospectFindManyMock,
    },
  },
}));

describe("outreach queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    draftFindManyMock.mockResolvedValue([]);
    draftCountMock.mockResolvedValue(0);
    prospectFindManyMock.mockResolvedValue([]);
    prospectFindFirstMock.mockResolvedValue({
      contactEmail: "jordan@acme.example",
      contactName: "Jordan",
    });
    profileFindUniqueMock.mockResolvedValue({ id: "profile_1" });
    recommendationFindFirstMock.mockResolvedValue(null);
    auditFindFirstMock.mockResolvedValue(null);
  });

  it("defaults to completed drafts and normalizes a failed filter", async () => {
    const { parseOutreachListParams } = await import("./queries");

    expect(parseOutreachListParams({})).toEqual({
      page: 1,
      status: "COMPLETED",
    });
    expect(parseOutreachListParams({ page: "2", status: "failed" })).toEqual({
      page: 2,
      status: "FAILED",
    });
    expect(
      parseOutreachListParams({ page: "not-a-page", status: "running" })
    ).toEqual({ page: 1, status: "COMPLETED" });
  });

  it("lists 25 newest owner-scoped drafts and resolves prospect names in one batch", async () => {
    draftFindManyMock.mockResolvedValue([
      { id: "draft_1", prospectId: "prospect_1" },
      { id: "draft_2", prospectId: "prospect_1" },
    ]);
    draftCountMock.mockResolvedValue(26);
    prospectFindManyMock.mockResolvedValue([
      { businessName: "Acme", id: "prospect_1" },
    ]);
    const { getOutreachDrafts } = await import("./queries");

    await expect(
      getOutreachDrafts({
        page: 2,
        status: "FAILED",
        userId: "user_owner",
      })
    ).resolves.toEqual({
      drafts: [
        { id: "draft_1", prospectId: "prospect_1", prospectName: "Acme" },
        { id: "draft_2", prospectId: "prospect_1", prospectName: "Acme" },
      ],
      pageCount: 2,
      total: 26,
    });

    const where = { status: "FAILED", userId: "user_owner" };
    expect(draftFindManyMock).toHaveBeenCalledWith({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: 25,
      take: 25,
      where,
    });
    expect(draftCountMock).toHaveBeenCalledWith({ where });
    expect(prospectFindManyMock).toHaveBeenCalledWith({
      select: { businessName: true, id: true },
      where: { id: { in: ["prospect_1"] }, userId: "user_owner" },
    });
  });

  it("loads one draft with both the draft and owner IDs", async () => {
    draftFindFirstMock.mockResolvedValue(null);
    const { getOutreachDraftDetail } = await import("./queries");

    await expect(
      getOutreachDraftDetail("user_owner", "draft_1")
    ).resolves.toBeNull();
    expect(draftFindFirstMock).toHaveBeenCalledWith({
      where: { id: "draft_1", userId: "user_owner" },
    });
  });

  it("loads source audit evidence through owner-scoped analysis and audit reads", async () => {
    draftFindFirstMock.mockResolvedValue({
      id: "draft_1",
      userId: "user_owner",
      analysisId: "analysis_1",
      recommendationId: "recommendation_1",
    });
    recommendationFindFirstMock.mockResolvedValue({
      auditCheckKeys: ["contact_path", "mobile_viewport"],
      analysis: { auditId: "audit_1" },
    });
    auditFindFirstMock.mockResolvedValue({
      id: "audit_1",
      checks: [
        { key: "contact_path", label: "Contact paths" },
        { key: "mobile_viewport", label: "Mobile viewport" },
      ],
    });
    const { getOutreachDraftDetail } = await import("./queries");

    await expect(
      getOutreachDraftDetail("user_owner", "draft_1")
    ).resolves.toEqual({
      id: "draft_1",
      userId: "user_owner",
      analysisId: "analysis_1",
      recommendationId: "recommendation_1",
      sourceAudit: {
        id: "audit_1",
        evidence: [
          { key: "contact_path", label: "Contact paths" },
          { key: "mobile_viewport", label: "Mobile viewport" },
        ],
      },
    });
    expect(recommendationFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: "recommendation_1",
        analysis: { id: "analysis_1", userId: "user_owner" },
      },
      select: {
        analysis: { select: { auditId: true } },
        auditCheckKeys: true,
      },
    });
    expect(auditFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: "audit_1",
        userId: "user_owner",
        status: "COMPLETED",
      },
      select: {
        id: true,
        checks: {
          where: {
            key: { in: ["contact_path", "mobile_viewport"] },
          },
          select: { key: true, label: true },
        },
      },
    });
  });

  it("reports missing contact from an owner-scoped prospect read", async () => {
    prospectFindFirstMock.mockResolvedValue({
      contactEmail: null,
      contactName: "Jordan",
    });
    const { getOutreachReadiness } = await import("./queries");

    await expect(
      getOutreachReadiness("user_owner", "prospect_1")
    ).resolves.toEqual({ status: "missing_contact" });
    expect(prospectFindFirstMock).toHaveBeenCalledWith({
      select: { contactEmail: true, contactName: true },
      where: { id: "prospect_1", userId: "user_owner" },
    });
  });

  it("reports a missing owner profile only after contact readiness", async () => {
    profileFindUniqueMock.mockResolvedValue(null);
    const { getOutreachReadiness } = await import("./queries");

    await expect(
      getOutreachReadiness("user_owner", "prospect_1")
    ).resolves.toEqual({ status: "missing_profile" });
    expect(profileFindUniqueMock).toHaveBeenCalledWith({
      where: { userId: "user_owner" },
    });
  });

  it("reports ready only when the owned prospect and profile are complete", async () => {
    const { getOutreachReadiness } = await import("./queries");

    await expect(
      getOutreachReadiness("user_owner", "prospect_1")
    ).resolves.toEqual({ status: "ready" });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyMock = vi.fn();
const countMock = vi.fn();
const findFirstMock = vi.fn();
const prospectFindManyMock = vi.fn();

vi.mock("@repo/database", () => ({
  database: {
    opportunityAnalysis: {
      findMany: findManyMock,
      count: countMock,
      findFirst: findFirstMock,
    },
    prospect: { findMany: prospectFindManyMock, findFirst: vi.fn() },
    websiteAudit: { findFirst: vi.fn() },
  },
}));

describe("opportunity queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findManyMock.mockResolvedValue([]);
    countMock.mockResolvedValue(0);
    prospectFindManyMock.mockResolvedValue([]);
  });

  it("normalizes page and status filters", async () => {
    const { parseOpportunityListParams } = await import("./queries");
    expect(
      parseOpportunityListParams({ page: "bad", status: "unknown" })
    ).toEqual({ page: 1, status: "COMPLETED" });
    expect(parseOpportunityListParams({ page: "2", status: "failed" })).toEqual(
      { page: 2, status: "FAILED" }
    );
  });

  it("lists 25 analyses with owner scope", async () => {
    const { getOpportunities } = await import("./queries");
    await getOpportunities({ userId: "user_owner", page: 2, status: "FAILED" });
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user_owner", status: "FAILED" },
        skip: 25,
        take: 25,
      })
    );
  });

  it("loads a detail using analysis and owner IDs", async () => {
    findFirstMock.mockResolvedValue(null);
    const { getOpportunityDetail } = await import("./queries");
    await expect(
      getOpportunityDetail("user_owner", "analysis_1")
    ).resolves.toBeNull();
    expect(findFirstMock).toHaveBeenCalledWith({
      where: { id: "analysis_1", userId: "user_owner" },
      include: { recommendations: { orderBy: { position: "asc" } } },
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyMock = vi.fn();
const countMock = vi.fn();
const prospectFindManyMock = vi.fn();
const findFirstMock = vi.fn();

vi.mock("@repo/database", () => ({
  database: {
    websiteAudit: {
      findMany: findManyMock,
      count: countMock,
      findFirst: findFirstMock,
    },
    prospect: { findMany: prospectFindManyMock, findFirst: vi.fn() },
  },
}));

describe("audit queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findManyMock.mockResolvedValue([]);
    countMock.mockResolvedValue(0);
    prospectFindManyMock.mockResolvedValue([]);
  });

  it("normalizes list parameters", async () => {
    const { parseAuditListParams } = await import("./queries");
    expect(parseAuditListParams({ page: "-4", status: "unknown" })).toEqual({
      page: 1,
      status: "ALL",
    });
    expect(parseAuditListParams({ page: "2", status: "failed" })).toEqual({
      page: 2,
      status: "FAILED",
    });
  });

  it("lists with owner scope and fixed pagination", async () => {
    const { getAudits } = await import("./queries");
    await getAudits({ userId: "user_owner", status: "COMPLETED", page: 2 });
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user_owner", status: "COMPLETED" },
        skip: 25,
        take: 25,
      })
    );
  });

  it("loads detail with both audit and owner IDs", async () => {
    findFirstMock.mockResolvedValue(null);
    const { getAuditDetail } = await import("./queries");
    await expect(getAuditDetail("user_owner", "audit_1")).resolves.toBeNull();
    expect(findFirstMock).toHaveBeenCalledWith({
      where: { id: "audit_1", userId: "user_owner" },
      include: { checks: true },
    });
  });
});

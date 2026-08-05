import { beforeEach, describe, expect, it, vi } from "vitest";

const taskCountMock = vi.fn();
const prospectCountMock = vi.fn();
const dealAggregateMock = vi.fn();

vi.mock("@repo/database", () => ({
  database: {
    deal: { aggregate: dealAggregateMock },
    prospect: { count: prospectCountMock },
    task: { count: taskCountMock },
  },
}));

describe("dashboard queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskCountMock.mockResolvedValueOnce(3).mockResolvedValueOnce(5);
    prospectCountMock.mockResolvedValue(7);
    dealAggregateMock.mockResolvedValue({ _sum: { valueCents: 125_000 } });
  });

  it("aggregates only the owner's current operational work", async () => {
    const now = new Date("2026-08-04T16:30:00.000Z");
    const start = new Date("2026-08-04T04:00:00.000Z");
    const end = new Date("2026-08-05T04:00:00.000Z");
    const { getDashboardMetrics } = await import("./queries");

    await expect(getDashboardMetrics("user_owner", now)).resolves.toEqual({
      activeProspectCount: 7,
      dueTodayTaskCount: 5,
      openDealValueCents: 125_000,
      overdueTaskCount: 3,
    });

    expect(taskCountMock).toHaveBeenNthCalledWith(1, {
      where: {
        dueAt: { lt: now },
        status: "OPEN",
        userId: "user_owner",
      },
    });
    expect(taskCountMock).toHaveBeenNthCalledWith(2, {
      where: {
        dueAt: { gte: start, lt: end },
        status: "OPEN",
        userId: "user_owner",
      },
    });
    expect(prospectCountMock).toHaveBeenCalledWith({
      where: { archivedAt: null, userId: "user_owner" },
    });
    expect(dealAggregateMock).toHaveBeenCalledWith({
      _sum: { valueCents: true },
      where: {
        prospect: {
          archivedAt: null,
          pipelineStage: { in: ["INTERESTED", "PROPOSAL"] },
          userId: "user_owner",
        },
        userId: "user_owner",
        valueCents: { not: null },
      },
    });
  });

  it("normalizes a null deal sum to zero", async () => {
    dealAggregateMock.mockResolvedValue({ _sum: { valueCents: null } });
    const { getDashboardMetrics } = await import("./queries");

    await expect(
      getDashboardMetrics("user_owner", new Date("2026-08-04T16:30:00.000Z"))
    ).resolves.toMatchObject({ openDealValueCents: 0 });
  });
});

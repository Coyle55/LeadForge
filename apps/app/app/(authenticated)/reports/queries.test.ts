import { beforeEach, describe, expect, it, vi } from "vitest";

const prospectCountMock = vi.fn();
const stageChangeFindManyMock = vi.fn();
const dealFindManyMock = vi.fn();
const taskFindManyMock = vi.fn();
const websiteAuditFindManyMock = vi.fn();
const outreachDraftFindManyMock = vi.fn();

vi.mock("@repo/database", () => ({
  database: {
    deal: { findMany: dealFindManyMock },
    outreachDraft: { findMany: outreachDraftFindManyMock },
    pipelineStageChange: { findMany: stageChangeFindManyMock },
    prospect: { count: prospectCountMock },
    task: { findMany: taskFindManyMock },
    websiteAudit: { findMany: websiteAuditFindManyMock },
  },
}));

const now = new Date("2026-08-05T12:00:00.000Z");

describe("getReportsMetrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prospectCountMock.mockResolvedValue(0);
    stageChangeFindManyMock.mockResolvedValue([]);
    dealFindManyMock.mockResolvedValue([]);
    taskFindManyMock.mockResolvedValue([]);
    websiteAuditFindManyMock.mockResolvedValue([]);
    outreachDraftFindManyMock.mockResolvedValue([]);
  });

  it("computes null conversion and win rates when there is no history", async () => {
    const { getReportsMetrics } = await import("./queries");

    const metrics = await getReportsMetrics("user_owner", now);

    expect(metrics.conversionRates.every((c) => c.rate === null)).toBe(true);
    expect(metrics.winRate).toBeNull();
    expect(metrics.revenueTrend).toHaveLength(12);
    expect(metrics.revenueTrend.every((point) => point.valueCents === 0)).toBe(
      true
    );
  });

  it("computes stage-to-stage conversion from distinct reached prospects", async () => {
    stageChangeFindManyMock.mockImplementation(({ where }) => {
      const counts: Record<string, number> = {
        NEW: 10,
        CONTACTED: 6,
        INTERESTED: 3,
        PROPOSAL: 1,
      };
      return Promise.resolve(
        Array.from({ length: counts[where.toStage] ?? 0 }, (_, index) => ({
          prospectId: `prospect_${where.toStage}_${index}`,
        }))
      );
    });
    const { getReportsMetrics } = await import("./queries");

    const metrics = await getReportsMetrics("user_owner", now);

    expect(metrics.conversionRates).toEqual([
      { from: "NEW", to: "CONTACTED", rate: 0.6 },
      { from: "CONTACTED", to: "INTERESTED", rate: 0.5 },
      { from: "INTERESTED", to: "PROPOSAL", rate: 1 / 3 },
    ]);
  });

  it("combines won deals and the most recent Lost transitions for win rate", async () => {
    dealFindManyMock.mockResolvedValue([
      {
        actualCloseDate: new Date("2026-08-01T12:00:00.000Z"),
        valueCents: 10_000,
      },
      {
        actualCloseDate: new Date("2026-07-15T12:00:00.000Z"),
        valueCents: 20_000,
      },
      {
        actualCloseDate: new Date("2026-06-01T12:00:00.000Z"),
        valueCents: 30_000,
      },
    ]);
    stageChangeFindManyMock.mockImplementation(({ where }) => {
      if (where.toStage === "LOST") {
        return Promise.resolve([
          { changedAt: new Date("2026-07-01T00:00:00.000Z") },
        ]);
      }
      return Promise.resolve([]);
    });
    const { getReportsMetrics } = await import("./queries");

    const metrics = await getReportsMetrics("user_owner", now);

    expect(metrics.winRate).toBe(0.75);
  });

  it("zero-fills months with no won revenue and sums cents by close-date month", async () => {
    dealFindManyMock.mockResolvedValue([
      {
        actualCloseDate: new Date("2026-08-02T00:00:00.000Z"),
        valueCents: 150_000,
      },
    ]);
    const { getReportsMetrics } = await import("./queries");

    const metrics = await getReportsMetrics("user_owner", now);

    const august = metrics.revenueTrend.find(
      (point) => point.month === "2026-08"
    );
    const july = metrics.revenueTrend.find(
      (point) => point.month === "2026-07"
    );
    expect(august?.valueCents).toBe(150_000);
    expect(july?.valueCents).toBe(0);
  });

  it("includes a deal closed earlier today even when `now`'s time-of-day precedes its noon-UTC close timestamp", async () => {
    // actualCloseDate is stored as a date-only value at noon UTC (see
    // packages/validation/pipeline.ts). If the won-deal query's upper bound
    // were `lte: now` instead of the trend window's exclusive month end, a
    // deal closed "today" would be excluded whenever /reports loads before
    // that day's noon-UTC timestamp. `now` here is 08:00 UTC, two hours
    // before the deal's actualCloseDate the same day.
    const earlyMorningNow = new Date("2026-08-05T08:00:00.000Z");
    const dealClosedAtNoonToday = {
      actualCloseDate: new Date("2026-08-05T12:00:00.000Z"),
      valueCents: 75_000,
    };

    dealFindManyMock.mockImplementation(({ where }) => {
      const range = where.actualCloseDate as {
        gte?: Date;
        lt?: Date;
        lte?: Date;
      };
      const { actualCloseDate } = dealClosedAtNoonToday;
      if (range.gte && actualCloseDate < range.gte) {
        return Promise.resolve([]);
      }
      if (range.lt && actualCloseDate >= range.lt) {
        return Promise.resolve([]);
      }
      if (range.lte && actualCloseDate > range.lte) {
        return Promise.resolve([]);
      }
      return Promise.resolve([dealClosedAtNoonToday]);
    });
    const { getReportsMetrics } = await import("./queries");

    const metrics = await getReportsMetrics("user_owner", earlyMorningNow);

    const august = metrics.revenueTrend.find(
      (point) => point.month === "2026-08"
    );
    expect(august?.valueCents).toBe(75_000);
    expect(metrics.winRate).toBe(1);
  });
});

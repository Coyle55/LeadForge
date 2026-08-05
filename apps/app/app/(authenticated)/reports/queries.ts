import { database, type PipelineStage } from "@repo/database";

import {
  getTrailingMonths,
  type MonthBucket,
  sumByMonth,
} from "../../lib/reports/months";

const ACTIVE_FUNNEL_STAGES: PipelineStage[] = [
  "NEW",
  "CONTACTED",
  "INTERESTED",
  "PROPOSAL",
];
const TREND_MONTH_COUNT = 12;

export interface FunnelStageCount {
  count: number;
  stage: PipelineStage;
}

export interface StageConversion {
  from: PipelineStage;
  rate: number | null;
  to: PipelineStage;
}

export interface MonthlyPoint {
  label: string;
  month: string;
}

export interface RevenuePoint extends MonthlyPoint {
  valueCents: number;
}

export interface TaskTrendPoint extends MonthlyPoint {
  completed: number;
  created: number;
}

export interface ActivityTrendPoint extends MonthlyPoint {
  audits: number;
  outreachDrafts: number;
}

export interface ReportsMetrics {
  activityTrend: ActivityTrendPoint[];
  conversionRates: StageConversion[];
  funnel: FunnelStageCount[];
  revenueTrend: RevenuePoint[];
  taskTrend: TaskTrendPoint[];
  terminalTotals: { lost: number; won: number };
  winRate: number | null;
}

const countReached = async (userId: string, stage: PipelineStage) => {
  const rows = await database.pipelineStageChange.findMany({
    where: { userId, toStage: stage },
    select: { prospectId: true },
    distinct: ["prospectId"],
  });
  return rows.length;
};

const getMostRecentLostDates = async (userId: string) => {
  const rows = await database.pipelineStageChange.findMany({
    where: { userId, toStage: "LOST", prospect: { pipelineStage: "LOST" } },
    orderBy: { changedAt: "desc" },
    distinct: ["prospectId"],
    select: { changedAt: true },
  });
  return rows.map((row) => row.changedAt);
};

const toMonthlyPoints = (months: MonthBucket[]): MonthlyPoint[] =>
  months.map((month) => ({ month: month.key, label: month.label }));

export const getReportsMetrics = async (
  userId: string,
  now = new Date()
): Promise<ReportsMetrics> => {
  const months = getTrailingMonths(now, TREND_MONTH_COUNT);
  const windowStart = months[0].start;
  const windowEnd = months.at(-1)?.end ?? now;

  const [
    funnelCounts,
    reachedCounts,
    wonDeals,
    lostDates,
    createdTasks,
    completedTasks,
    audits,
    outreachDrafts,
    wonTotal,
    lostTotal,
  ] = await Promise.all([
    Promise.all(
      ACTIVE_FUNNEL_STAGES.map((stage) =>
        database.prospect.count({
          where: { userId, archivedAt: null, pipelineStage: stage },
        })
      )
    ),
    Promise.all(
      ACTIVE_FUNNEL_STAGES.map((stage) => countReached(userId, stage))
    ),
    database.deal.findMany({
      where: {
        userId,
        prospect: { pipelineStage: "WON" },
        // Bound by the month bucket's exclusive end, not the exact instant
        // `now`, since `actualCloseDate` is stored as a date-only value at
        // noon UTC: a deal closed "today" must not disappear just because
        // the page loaded before that day's noon-UTC timestamp.
        actualCloseDate: { gte: windowStart, lt: windowEnd },
      },
      select: { actualCloseDate: true, valueCents: true },
    }),
    getMostRecentLostDates(userId),
    database.task.findMany({
      where: { userId, createdAt: { gte: windowStart, lte: now } },
      select: { createdAt: true },
    }),
    database.task.findMany({
      where: {
        userId,
        status: "COMPLETED",
        completedAt: { gte: windowStart, lte: now },
      },
      select: { completedAt: true },
    }),
    database.websiteAudit.findMany({
      where: { userId, createdAt: { gte: windowStart, lte: now } },
      select: { createdAt: true },
    }),
    database.outreachDraft.findMany({
      where: { userId, createdAt: { gte: windowStart, lte: now } },
      select: { createdAt: true },
    }),
    database.prospect.count({ where: { userId, pipelineStage: "WON" } }),
    database.prospect.count({ where: { userId, pipelineStage: "LOST" } }),
  ]);

  const funnel = ACTIVE_FUNNEL_STAGES.map((stage, index) => ({
    stage,
    count: funnelCounts[index],
  }));

  const conversionRates: StageConversion[] = ACTIVE_FUNNEL_STAGES.slice(
    0,
    -1
  ).map((stage, index) => {
    const reachedFrom = reachedCounts[index];
    const reachedTo = reachedCounts[index + 1];
    return {
      from: stage,
      to: ACTIVE_FUNNEL_STAGES[index + 1],
      rate: reachedFrom === 0 ? null : reachedTo / reachedFrom,
    };
  });

  const wonCountInWindow = wonDeals.length;
  const lostCountInWindow = lostDates.filter(
    (date) => date >= windowStart && date <= now
  ).length;
  const closedInWindow = wonCountInWindow + lostCountInWindow;
  const winRate =
    closedInWindow === 0 ? null : wonCountInWindow / closedInWindow;

  const monthlyPoints = toMonthlyPoints(months);
  const revenueValues = sumByMonth(
    months,
    wonDeals,
    (deal) => deal.actualCloseDate as Date,
    (deal) => deal.valueCents ?? 0
  );
  const createdCounts = sumByMonth(
    months,
    createdTasks,
    (task) => task.createdAt
  );
  const completedCounts = sumByMonth(
    months,
    completedTasks,
    (task) => task.completedAt as Date
  );
  const auditCounts = sumByMonth(months, audits, (audit) => audit.createdAt);
  const outreachCounts = sumByMonth(
    months,
    outreachDrafts,
    (draft) => draft.createdAt
  );

  return {
    funnel,
    terminalTotals: { won: wonTotal, lost: lostTotal },
    conversionRates,
    winRate,
    revenueTrend: monthlyPoints.map((point, index) => ({
      ...point,
      valueCents: revenueValues[index],
    })),
    taskTrend: monthlyPoints.map((point, index) => ({
      ...point,
      created: createdCounts[index],
      completed: completedCounts[index],
    })),
    activityTrend: monthlyPoints.map((point, index) => ({
      ...point,
      audits: auditCounts[index],
      outreachDrafts: outreachCounts[index],
    })),
  };
};

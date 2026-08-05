import { database } from "@repo/database";

import { getTaskDayBounds } from "../../lib/tasks/time";

export const getDashboardMetrics = async (userId: string, now = new Date()) => {
  const { start, end } = getTaskDayBounds(now);
  const [overdueTaskCount, dueTodayTaskCount, activeProspectCount, dealValue] =
    await Promise.all([
      database.task.count({
        where: { userId, status: "OPEN", dueAt: { lt: now } },
      }),
      database.task.count({
        where: {
          userId,
          status: "OPEN",
          dueAt: { gte: start, lt: end },
        },
      }),
      database.prospect.count({ where: { userId, archivedAt: null } }),
      database.deal.aggregate({
        where: {
          userId,
          valueCents: { not: null },
          prospect: {
            userId,
            archivedAt: null,
            pipelineStage: { in: ["INTERESTED", "PROPOSAL"] },
          },
        },
        _sum: { valueCents: true },
      }),
    ]);

  return {
    overdueTaskCount,
    dueTodayTaskCount,
    activeProspectCount,
    openDealValueCents: dealValue._sum.valueCents ?? 0,
  };
};

import { database, type PipelineStage } from "@repo/database";

export const PIPELINE_STAGES = [
  "NEW",
  "CONTACTED",
  "INTERESTED",
  "PROPOSAL",
  "WON",
  "LOST",
] as const satisfies readonly PipelineStage[];

export interface PipelineCard {
  businessName: string;
  contactName: string | null;
  dealValueCents: number | null;
  id: string;
  nearestTaskDueAt: Date | null;
  openTaskCount: number;
  websiteUrl: string | null;
}

export type PipelineGroups = Record<PipelineStage, PipelineCard[]>;

type SortablePipelineCard = PipelineCard & { updatedAt: Date };

const emptyPipeline = <T>(): Record<PipelineStage, T[]> => ({
  NEW: [],
  CONTACTED: [],
  INTERESTED: [],
  PROPOSAL: [],
  WON: [],
  LOST: [],
});

const compareCards = (
  left: SortablePipelineCard,
  right: SortablePipelineCard
) => {
  if (left.nearestTaskDueAt && right.nearestTaskDueAt) {
    const nearestDifference =
      left.nearestTaskDueAt.getTime() - right.nearestTaskDueAt.getTime();
    if (nearestDifference !== 0) {
      return nearestDifference;
    }
  } else if (left.nearestTaskDueAt) {
    return -1;
  } else if (right.nearestTaskDueAt) {
    return 1;
  }

  const updatedDifference =
    right.updatedAt.getTime() - left.updatedAt.getTime();
  if (updatedDifference !== 0) {
    return updatedDifference;
  }

  if (left.id === right.id) {
    return 0;
  }
  return left.id < right.id ? -1 : 1;
};

export const getPipeline = async (userId: string): Promise<PipelineGroups> => {
  const prospects = await database.prospect.findMany({
    where: { userId, archivedAt: null },
    select: {
      id: true,
      businessName: true,
      contactName: true,
      websiteUrl: true,
      pipelineStage: true,
      updatedAt: true,
    },
  });
  const sortableGroups = emptyPipeline<SortablePipelineCard>();
  if (prospects.length === 0) {
    return sortableGroups;
  }

  const prospectIds = prospects.map(({ id }) => id);
  const [deals, openTasks] = await Promise.all([
    database.deal.findMany({
      where: { userId, prospectId: { in: prospectIds } },
      select: { prospectId: true, valueCents: true },
    }),
    database.task.findMany({
      where: { userId, prospectId: { in: prospectIds }, status: "OPEN" },
      select: { prospectId: true, dueAt: true },
    }),
  ]);

  const dealValueByProspect = new Map(
    deals.map(({ prospectId, valueCents }) => [prospectId, valueCents])
  );
  const openTaskStats = new Map<
    string,
    { count: number; nearestDueAt: Date }
  >();
  for (const task of openTasks) {
    const current = openTaskStats.get(task.prospectId);
    if (!current) {
      openTaskStats.set(task.prospectId, {
        count: 1,
        nearestDueAt: task.dueAt,
      });
      continue;
    }

    current.count += 1;
    if (task.dueAt.getTime() < current.nearestDueAt.getTime()) {
      current.nearestDueAt = task.dueAt;
    }
  }

  for (const prospect of prospects) {
    const taskStats = openTaskStats.get(prospect.id);
    sortableGroups[prospect.pipelineStage].push({
      id: prospect.id,
      businessName: prospect.businessName,
      contactName: prospect.contactName,
      websiteUrl: prospect.websiteUrl,
      dealValueCents: dealValueByProspect.get(prospect.id) ?? null,
      openTaskCount: taskStats?.count ?? 0,
      nearestTaskDueAt: taskStats?.nearestDueAt ?? null,
      updatedAt: prospect.updatedAt,
    });
  }

  const result = emptyPipeline<PipelineCard>();
  for (const stage of PIPELINE_STAGES) {
    result[stage] = sortableGroups[stage]
      .sort(compareCards)
      .map(({ updatedAt: _updatedAt, ...card }) => card);
  }
  return result;
};

export const getProspectPipelineDetail = async (
  userId: string,
  prospectId: string
) => {
  const prospect = await database.prospect.findFirst({
    where: { id: prospectId, userId },
    select: { id: true, pipelineStage: true, archivedAt: true },
  });
  if (!prospect) {
    return null;
  }

  const deal = await database.deal.findFirst({
    where: { prospectId: prospect.id, userId },
    select: {
      valueCents: true,
      expectedCloseDate: true,
      actualCloseDate: true,
      lossReason: true,
    },
  });

  return { ...prospect, deal };
};

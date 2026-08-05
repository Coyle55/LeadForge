import { database, type Prisma, type TaskPriority } from "@repo/database";

import { getTaskDayBounds } from "../../lib/tasks/time";

export const TASK_PAGE_SIZE = 25;

export type TaskListStatus = "OPEN" | "DUE_TODAY" | "OVERDUE" | "COMPLETED";
export type TaskListPriority = "ALL" | TaskPriority;

const TASK_PRIORITIES = [
  "HIGH",
  "MEDIUM",
  "LOW",
] as const satisfies readonly TaskPriority[];

const first = (value?: string | string[]) =>
  Array.isArray(value) ? value[0] : value;

export const parseTaskListParams = (params: {
  page?: string | string[];
  priority?: string | string[];
  status?: string | string[];
}): { page: number; priority: TaskListPriority; status: TaskListStatus } => {
  const parsedPage = Number.parseInt(first(params.page) ?? "1", 10);
  const rawStatus = first(params.status)?.toUpperCase();
  const rawPriority = first(params.priority)?.toUpperCase();

  return {
    page: Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1,
    priority: TASK_PRIORITIES.includes(rawPriority as TaskPriority)
      ? (rawPriority as TaskPriority)
      : "ALL",
    status:
      rawStatus === "DUE_TODAY" ||
      rawStatus === "OVERDUE" ||
      rawStatus === "COMPLETED"
        ? rawStatus
        : "OPEN",
  };
};

const openTaskOrder: Prisma.TaskOrderByWithRelationInput[] = [
  { dueAt: "asc" },
  { priority: "asc" },
  { createdAt: "asc" },
  { id: "asc" },
];

const completedTaskOrder: Prisma.TaskOrderByWithRelationInput[] = [
  { completedAt: "desc" },
  { id: "asc" },
];

const getTaskWhere = ({
  userId,
  status,
  priority,
  now,
}: {
  userId: string;
  status: TaskListStatus;
  priority: TaskListPriority;
  now: Date;
}): Prisma.TaskWhereInput => {
  let statusWhere: Prisma.TaskWhereInput = { userId, status: "OPEN" };

  if (status === "DUE_TODAY") {
    const { start, end } = getTaskDayBounds(now);
    statusWhere = { userId, status: "OPEN", dueAt: { gte: start, lt: end } };
  } else if (status === "OVERDUE") {
    statusWhere = { userId, status: "OPEN", dueAt: { lt: now } };
  } else if (status === "COMPLETED") {
    statusWhere = { userId, status: "COMPLETED" };
  }

  return priority === "ALL" ? statusWhere : { ...statusWhere, priority };
};

export const getTasks = async ({
  userId,
  page,
  status,
  priority,
  now = new Date(),
}: {
  userId: string;
  page: number;
  status: TaskListStatus;
  priority: TaskListPriority;
  now?: Date;
}) => {
  const where = getTaskWhere({ userId, status, priority, now });
  const orderBy = status === "COMPLETED" ? completedTaskOrder : openTaskOrder;
  const [tasks, total] = await Promise.all([
    database.task.findMany({
      where,
      orderBy,
      skip: (page - 1) * TASK_PAGE_SIZE,
      take: TASK_PAGE_SIZE,
    }),
    database.task.count({ where }),
  ]);
  const prospectIds = [...new Set(tasks.map(({ prospectId }) => prospectId))];
  const prospects = await database.prospect.findMany({
    where: { userId, id: { in: prospectIds } },
    select: { id: true, businessName: true },
  });
  const prospectNames = new Map(
    prospects.map(({ id, businessName }) => [id, businessName])
  );

  return {
    tasks: tasks.map((task) => ({
      ...task,
      prospectName: prospectNames.get(task.prospectId) ?? "Unknown prospect",
    })),
    total,
    pageCount: Math.ceil(total / TASK_PAGE_SIZE),
  };
};

export const getProspectTasks = async (userId: string, prospectId: string) => {
  const [openTasks, completedTasks] = await Promise.all([
    database.task.findMany({
      where: { userId, prospectId, status: "OPEN" },
      orderBy: openTaskOrder,
    }),
    database.task.findMany({
      where: { userId, prospectId, status: "COMPLETED" },
      orderBy: completedTaskOrder,
    }),
  ]);

  return { openTasks, completedTasks };
};

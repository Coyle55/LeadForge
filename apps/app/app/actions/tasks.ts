"use server";

import { isAllowedUserId } from "@repo/auth";
import { auth } from "@repo/auth/server";
import { database } from "@repo/database";
import { logger } from "@repo/observability";
import { taskInputSchema } from "@repo/validation";
import { revalidatePath } from "next/cache";

export interface TaskFormState {
  fieldErrors?: Record<string, string[]>;
  message?: string;
  status?: "success" | "error";
}

export interface TaskActionResult {
  message: string;
  status: "success" | "error";
}

type TaskMutationAction = "complete" | "create" | "reopen" | "update";
interface TaskMutationIds {
  prospectId?: string;
  taskId?: string;
  userId: string;
}

const authorize = async () => {
  const { userId } = await auth();
  return userId && isAllowedUserId(userId) ? userId : null;
};

const parseTaskForm = (formData: FormData) =>
  taskInputSchema.safeParse({
    title: formData.get("title"),
    dueAt: formData.get("dueAt"),
    priority: formData.get("priority"),
  });

const safeErrorLog = (
  event: string,
  metadata: TaskMutationIds & {
    action: TaskMutationAction;
    code: "CACHE_REVALIDATION_ERROR" | "DATABASE_ERROR" | "LOGGING_ERROR";
  }
) => {
  try {
    logger.error(event, { ...metadata });
  } catch {
    // Observability must never change an action result.
  }
};

const logMutationSuccess = (
  action: TaskMutationAction,
  ids: TaskMutationIds
) => {
  try {
    logger.info("task.mutation.succeeded", { action, ...ids });
  } catch {
    safeErrorLog("task.observability.failed", {
      action,
      code: "LOGGING_ERROR",
      ...ids,
    });
  }
};

const revalidateTaskPaths = (
  prospectId: string,
  action: TaskMutationAction,
  ids: TaskMutationIds
) => {
  let failed = false;
  for (const path of ["/tasks", `/prospects/${prospectId}`, "/"]) {
    try {
      revalidatePath(path);
    } catch {
      failed = true;
    }
  }

  if (failed) {
    safeErrorLog("task.revalidation.failed", {
      action,
      code: "CACHE_REVALIDATION_ERROR",
      ...ids,
    });
  }
};

const logPersistenceFailure = (
  userId: string,
  action: TaskMutationAction,
  record: { prospectId: string } | { taskId: string }
) => {
  safeErrorLog("task.mutation.failed", {
    action,
    code: "DATABASE_ERROR",
    ...record,
    userId,
  });
};

const getOwnedTask = async (taskId: string, userId: string) =>
  await database.task.findFirst({
    where: { id: taskId, userId },
    select: { prospectId: true },
  });

export const createTask = async (
  prospectId: string,
  _previousState: TaskFormState,
  formData: FormData
): Promise<TaskFormState> => {
  const userId = await authorize();
  if (!userId) {
    return { status: "error", message: "Not authorized." };
  }

  const parsed = parseTaskForm(formData);
  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  let createdTaskId: string;
  let ownedProspectId: string;
  try {
    const prospect = await database.prospect.findFirst({
      where: { id: prospectId, userId, archivedAt: null },
      select: { id: true },
    });
    if (!prospect) {
      return { status: "error", message: "Prospect not found." };
    }

    const task = await database.task.create({
      data: {
        userId,
        prospectId: prospect.id,
        ...parsed.data,
      },
    });
    createdTaskId = task.id;
    ownedProspectId = prospect.id;
  } catch {
    logPersistenceFailure(userId, "create", { prospectId });
    return { status: "error", message: "Unable to save task." };
  }

  const ids = {
    prospectId: ownedProspectId,
    taskId: createdTaskId,
    userId,
  };
  logMutationSuccess("create", ids);
  revalidateTaskPaths(ownedProspectId, "create", ids);
  return { status: "success", message: "Task created." };
};

export const updateTask = async (
  taskId: string,
  _previousState: TaskFormState,
  formData: FormData
): Promise<TaskFormState> => {
  const userId = await authorize();
  if (!userId) {
    return { status: "error", message: "Not authorized." };
  }

  const parsed = parseTaskForm(formData);
  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  let ownedProspectId: string;
  try {
    const task = await getOwnedTask(taskId, userId);
    if (!task) {
      return { status: "error", message: "Task not found." };
    }

    const result = await database.task.updateMany({
      where: { id: taskId, userId },
      data: parsed.data,
    });
    if (result.count === 0) {
      return { status: "error", message: "Task not found." };
    }
    ownedProspectId = task.prospectId;
  } catch {
    logPersistenceFailure(userId, "update", { taskId });
    return { status: "error", message: "Unable to save task." };
  }

  const ids = { taskId, userId };
  logMutationSuccess("update", ids);
  revalidateTaskPaths(ownedProspectId, "update", ids);
  return { status: "success", message: "Task saved." };
};

const setTaskStatus = async (
  taskId: string,
  action: "complete" | "reopen"
): Promise<TaskActionResult> => {
  const userId = await authorize();
  if (!userId) {
    return { status: "error", message: "Not authorized." };
  }

  let ownedProspectId: string;
  try {
    const task = await getOwnedTask(taskId, userId);
    if (!task) {
      return { status: "error", message: "Task not found." };
    }

    const completing = action === "complete";
    const result = await database.task.updateMany({
      where: {
        id: taskId,
        userId,
        status: completing ? "OPEN" : "COMPLETED",
      },
      data: completing
        ? { status: "COMPLETED", completedAt: new Date() }
        : { status: "OPEN", completedAt: null },
    });
    if (result.count === 0) {
      return { status: "error", message: "Task not found." };
    }
    ownedProspectId = task.prospectId;
  } catch {
    logPersistenceFailure(userId, action, { taskId });
    return { status: "error", message: "Unable to update task." };
  }

  const ids = { taskId, userId };
  logMutationSuccess(action, ids);
  revalidateTaskPaths(ownedProspectId, action, ids);
  return {
    status: "success",
    message: action === "complete" ? "Task completed." : "Task reopened.",
  };
};

export const completeTask = async (taskId: string) =>
  await setTaskStatus(taskId, "complete");

export const reopenTask = async (taskId: string) =>
  await setTaskStatus(taskId, "reopen");

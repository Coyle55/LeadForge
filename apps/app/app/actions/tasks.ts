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

const revalidateTaskPaths = (prospectId: string) => {
  revalidatePath("/tasks");
  revalidatePath(`/prospects/${prospectId}`);
  revalidatePath("/");
};

const logPersistenceFailure = (
  userId: string,
  action: TaskMutationAction,
  record: { prospectId: string } | { taskId: string }
) => {
  logger.error("task.mutation.failed", {
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
    logger.info("task.mutation.succeeded", {
      action: "create",
      prospectId: prospect.id,
      taskId: task.id,
      userId,
    });
    revalidateTaskPaths(prospect.id);
    return { status: "success", message: "Task created." };
  } catch {
    logPersistenceFailure(userId, "create", { prospectId });
    return { status: "error", message: "Unable to save task." };
  }
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

    logger.info("task.mutation.succeeded", {
      action: "update",
      taskId,
      userId,
    });
    revalidateTaskPaths(task.prospectId);
    return { status: "success", message: "Task saved." };
  } catch {
    logPersistenceFailure(userId, "update", { taskId });
    return { status: "error", message: "Unable to save task." };
  }
};

const setTaskStatus = async (
  taskId: string,
  action: "complete" | "reopen"
): Promise<TaskActionResult> => {
  const userId = await authorize();
  if (!userId) {
    return { status: "error", message: "Not authorized." };
  }

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

    logger.info("task.mutation.succeeded", { action, taskId, userId });
    revalidateTaskPaths(task.prospectId);
    return {
      status: "success",
      message: completing ? "Task completed." : "Task reopened.",
    };
  } catch {
    logPersistenceFailure(userId, action, { taskId });
    return { status: "error", message: "Unable to update task." };
  }
};

export const completeTask = async (taskId: string) =>
  await setTaskStatus(taskId, "complete");

export const reopenTask = async (taskId: string) =>
  await setTaskStatus(taskId, "reopen");

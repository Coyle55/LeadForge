"use server";

import { isAllowedUserId } from "@repo/auth";
import { auth } from "@repo/auth/server";
import { database } from "@repo/database";
import { logger } from "@repo/observability";
import { prospectSchema } from "@repo/validation";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export interface ProspectFormState {
  fieldErrors?: Record<string, string[]>;
  message?: string;
  status?: "success" | "error";
}

export interface ProspectActionResult {
  message: string;
  status: "success" | "error";
}

type ProspectMutationAction = "archive" | "create" | "restore" | "update";
interface ProspectMutationIds {
  prospectId: string;
  userId: string;
}

const authorize = async () => {
  const { userId } = await auth();
  return userId && isAllowedUserId(userId) ? userId : null;
};

const parseForm = (formData: FormData) =>
  prospectSchema.safeParse({
    businessName: formData.get("businessName"),
    businessCategory: formData.get("businessCategory"),
    contactEmail: formData.get("contactEmail"),
    contactName: formData.get("contactName"),
    location: formData.get("location"),
    notes: formData.get("notes"),
    phone: formData.get("phone"),
    websiteUrl: formData.get("websiteUrl"),
  });

const safeErrorLog = (event: string, metadata: Record<string, unknown>) => {
  try {
    logger.error(event, metadata);
  } catch {
    // Observability must never change an action result.
  }
};

const logMutationSuccess = (
  event: string,
  metadata: Record<string, unknown>,
  action: ProspectMutationAction,
  ids: ProspectMutationIds
) => {
  try {
    logger.info(event, metadata);
  } catch {
    safeErrorLog("prospect.observability.failed", {
      action,
      code: "LOGGING_ERROR",
      ...ids,
    });
  }
};

const revalidateProspectPaths = (
  paths: string[],
  action: ProspectMutationAction,
  ids: ProspectMutationIds
) => {
  let failed = false;
  for (const path of paths) {
    try {
      revalidatePath(path);
    } catch {
      failed = true;
    }
  }

  if (failed) {
    safeErrorLog("prospect.revalidation.failed", {
      action,
      code: "CACHE_REVALIDATION_ERROR",
      ...ids,
    });
  }
};

export const createProspect = async (
  _previousState: ProspectFormState,
  formData: FormData
): Promise<ProspectFormState> => {
  const userId = await authorize();
  if (!userId) {
    return { status: "error", message: "Not authorized." };
  }

  const parsed = parseForm(formData);
  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  let prospectId: string;
  try {
    const prospect = await database.prospect.create({
      data: { userId, ...parsed.data },
    });
    prospectId = prospect.id;
  } catch {
    safeErrorLog("prospect.create.failed", { userId });
    return { status: "error", message: "Unable to save prospect." };
  }

  const ids = { userId, prospectId };
  logMutationSuccess("prospect.create.succeeded", ids, "create", ids);
  revalidateProspectPaths(["/prospects", "/pipeline", "/"], "create", ids);

  redirect(`/prospects/${prospectId}?created=1`);
  return { status: "success", message: "Prospect created." };
};

export const updateProspect = async (
  _previousState: ProspectFormState,
  formData: FormData
): Promise<ProspectFormState> => {
  const userId = await authorize();
  if (!userId) {
    return { status: "error", message: "Not authorized." };
  }

  const prospectId = String(formData.get("prospectId") ?? "");
  const parsed = parseForm(formData);
  if (!(prospectId && parsed.success)) {
    return {
      status: "error",
      message: "Check the highlighted fields.",
      ...(parsed.success
        ? {}
        : { fieldErrors: parsed.error.flatten().fieldErrors }),
    };
  }

  try {
    const result = await database.prospect.updateMany({
      where: { id: prospectId, userId },
      data: parsed.data,
    });
    if (result.count === 0) {
      return { status: "error", message: "Prospect not found." };
    }
  } catch {
    safeErrorLog("prospect.update.failed", { userId, prospectId });
    return { status: "error", message: "Unable to save prospect." };
  }

  const ids = { userId, prospectId };
  logMutationSuccess("prospect.update.succeeded", ids, "update", ids);
  revalidateProspectPaths(
    ["/prospects", "/pipeline", `/prospects/${prospectId}`],
    "update",
    ids
  );
  return { status: "success", message: "Prospect saved." };
};

const setProspectArchiveState = async (
  prospectId: string,
  archived: boolean
): Promise<ProspectActionResult> => {
  const userId = await authorize();
  if (!userId) {
    return { status: "error", message: "Not authorized." };
  }

  const action = archived ? "archive" : "restore";
  try {
    const archivedAt = archived ? new Date() : null;
    const result = await database.prospect.updateMany({
      where: { id: prospectId, userId },
      data: { archivedAt },
    });
    if (result.count === 0) {
      return { status: "error", message: "Prospect not found." };
    }
  } catch {
    safeErrorLog("prospect.archive_state.failed", { userId, prospectId });
    return { status: "error", message: "Unable to update prospect." };
  }

  const ids = { userId, prospectId };
  logMutationSuccess(
    "prospect.archive_state.succeeded",
    { ...ids, archived },
    action,
    ids
  );
  revalidateProspectPaths(
    ["/prospects", "/pipeline", "/tasks", `/prospects/${prospectId}`, "/"],
    action,
    ids
  );
  return {
    status: "success",
    message: archived ? "Prospect archived." : "Prospect restored.",
  };
};

export const archiveProspect = async (prospectId: string) =>
  await setProspectArchiveState(prospectId, true);

export const restoreProspect = async (prospectId: string) =>
  await setProspectArchiveState(prospectId, false);

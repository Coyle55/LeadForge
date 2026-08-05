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

const authorize = async () => {
  const { userId } = await auth();
  return userId && isAllowedUserId(userId) ? userId : null;
};

const parseForm = (formData: FormData) =>
  prospectSchema.safeParse({
    businessName: formData.get("businessName"),
    contactEmail: formData.get("contactEmail"),
    contactName: formData.get("contactName"),
    location: formData.get("location"),
    notes: formData.get("notes"),
    phone: formData.get("phone"),
    websiteUrl: formData.get("websiteUrl"),
  });

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
    logger.info("prospect.create.succeeded", { userId, prospectId });
    revalidatePath("/prospects");
    revalidatePath("/pipeline");
  } catch {
    logger.error("prospect.create.failed", { userId });
    return { status: "error", message: "Unable to save prospect." };
  }

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
    logger.info("prospect.update.succeeded", { userId, prospectId });
    revalidatePath("/prospects");
    revalidatePath("/pipeline");
    revalidatePath(`/prospects/${prospectId}`);
    return { status: "success", message: "Prospect saved." };
  } catch {
    logger.error("prospect.update.failed", { userId, prospectId });
    return { status: "error", message: "Unable to save prospect." };
  }
};

const setProspectArchiveState = async (
  prospectId: string,
  archived: boolean
): Promise<ProspectActionResult> => {
  const userId = await authorize();
  if (!userId) {
    return { status: "error", message: "Not authorized." };
  }

  try {
    const archivedAt = archived ? new Date() : null;
    const result = await database.prospect.updateMany({
      where: { id: prospectId, userId },
      data: { archivedAt },
    });
    if (result.count === 0) {
      return { status: "error", message: "Prospect not found." };
    }
    logger.info("prospect.archive_state.succeeded", {
      userId,
      prospectId,
      archived,
    });
    revalidatePath("/prospects");
    revalidatePath("/pipeline");
    revalidatePath(`/prospects/${prospectId}`);
    return {
      status: "success",
      message: archived ? "Prospect archived." : "Prospect restored.",
    };
  } catch {
    logger.error("prospect.archive_state.failed", { userId, prospectId });
    return { status: "error", message: "Unable to update prospect." };
  }
};

export const archiveProspect = async (prospectId: string) =>
  await setProspectArchiveState(prospectId, true);

export const restoreProspect = async (prospectId: string) =>
  await setProspectArchiveState(prospectId, false);

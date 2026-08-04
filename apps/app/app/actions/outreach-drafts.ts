"use server";

import { isAllowedUserId } from "@repo/auth";
import { auth } from "@repo/auth/server";
import { database } from "@repo/database";
import { logger } from "@repo/observability";
import { outreachDraftEditSchema } from "@repo/validation";
import { revalidatePath } from "next/cache";

export interface OutreachDraftState {
  message?: string;
  status?: "success" | "error";
}

const validationMessage =
  "Subject must be 3-120 characters and body must be 40-2,000 characters.";

const authorize = async () => {
  const { userId } = await auth();
  return userId && isAllowedUserId(userId) ? userId : null;
};

const revalidateDraftPaths = (draftId: string) => {
  revalidatePath("/outreach");
  revalidatePath(`/outreach/${draftId}`);
};

const logSuccess = (userId: string, draftId: string, action: string) => {
  logger.info("outreach_draft.update.succeeded", { userId, draftId, action });
};

const logFailure = (
  userId: string,
  draftId: string,
  action: string,
  error: unknown
) => {
  logger.error("outreach_draft.update.failed", {
    userId,
    draftId,
    action,
    error,
  });
};

export const updateOutreachDraft = async (
  _previousState: OutreachDraftState,
  formData: FormData
): Promise<OutreachDraftState> => {
  const userId = await authorize();
  if (!userId) {
    return { status: "error", message: "Not authorized." };
  }

  const draftId = formData.get("draftId");
  const values = outreachDraftEditSchema.safeParse({
    subject: formData.get("subject"),
    body: formData.get("body"),
  });
  if (!(typeof draftId === "string" && draftId && values.success)) {
    return { status: "error", message: validationMessage };
  }

  try {
    const result = await database.outreachDraft.updateMany({
      where: { id: draftId, userId, status: "COMPLETED" },
      data: values.data,
    });
    if (result.count === 0) {
      return { status: "error", message: "Not authorized." };
    }
    logSuccess(userId, draftId, "update");
    revalidateDraftPaths(draftId);
    return { status: "success", message: "Draft saved." };
  } catch (error) {
    logFailure(userId, draftId, "update", error);
    return { status: "error", message: "Unable to save outreach draft." };
  }
};

export const resetOutreachDraft = async (
  draftId: string
): Promise<OutreachDraftState> => {
  const userId = await authorize();
  if (!userId) {
    return { status: "error", message: "Not authorized." };
  }

  try {
    const draft = await database.outreachDraft.findFirst({
      where: { id: draftId, userId, status: "COMPLETED" },
      select: { generatedSubject: true, generatedBody: true },
    });
    if (!(draft?.generatedSubject && draft.generatedBody)) {
      return { status: "error", message: "Not authorized." };
    }
    const result = await database.outreachDraft.updateMany({
      where: { id: draftId, userId, status: "COMPLETED" },
      data: { subject: draft.generatedSubject, body: draft.generatedBody },
    });
    if (result.count === 0) {
      return { status: "error", message: "Not authorized." };
    }
    logSuccess(userId, draftId, "reset");
    revalidateDraftPaths(draftId);
    return { status: "success", message: "Draft reset." };
  } catch (error) {
    logFailure(userId, draftId, "reset", error);
    return { status: "error", message: "Unable to save outreach draft." };
  }
};

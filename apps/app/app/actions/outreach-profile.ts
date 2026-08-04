"use server";

import { isAllowedUserId } from "@repo/auth";
import { auth } from "@repo/auth/server";
import { database } from "@repo/database";
import { logger } from "@repo/observability";
import { outreachProfileSchema } from "@repo/validation";
import { revalidatePath } from "next/cache";

export interface OutreachProfileState {
  message?: string;
  status?: "success" | "error";
}

export const updateOutreachProfile = async (
  _previousState: OutreachProfileState,
  formData: FormData
): Promise<OutreachProfileState> => {
  const { userId } = await auth();
  if (!(userId && isAllowedUserId(userId))) {
    return { status: "error", message: "Not authorized." };
  }

  const values = outreachProfileSchema.safeParse({
    senderName: formData.get("senderName"),
    companyName: formData.get("companyName"),
    serviceOffered: formData.get("serviceOffered"),
    valueProposition: formData.get("valueProposition"),
    defaultCta: formData.get("defaultCta"),
  });
  if (!values.success) {
    return {
      status: "error",
      message: "Outreach profile must contain valid values.",
    };
  }

  try {
    await database.outreachProfile.upsert({
      where: { userId },
      create: { userId, ...values.data },
      update: values.data,
    });
    logger.info("outreach_profile.update.succeeded", { userId });
    revalidatePath("/settings");
    return { status: "success", message: "Outreach profile saved." };
  } catch {
    logger.error("outreach_profile.update.failed", { userId });
    return { status: "error", message: "Unable to save outreach profile." };
  }
};

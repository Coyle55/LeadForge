"use server";

import { isAllowedUserId } from "@repo/auth";
import { auth } from "@repo/auth/server";
import { database } from "@repo/database";
import { logger } from "@repo/observability";
import { settingsSchema } from "@repo/validation";
import { revalidatePath } from "next/cache";

export interface SettingsState {
  message?: string;
  status?: "success" | "error";
}

export const updateDisplayName = async (
  _previousState: SettingsState,
  formData: FormData
): Promise<SettingsState> => {
  const { userId } = await auth();
  if (!(userId && isAllowedUserId(userId))) {
    return { status: "error", message: "Not authorized." };
  }

  const parsed = settingsSchema.safeParse({
    displayName: formData.get("displayName"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Display name must be 1-80 characters.",
    };
  }

  try {
    await database.user.update({
      where: { id: userId },
      data: { displayName: parsed.data.displayName },
    });
    logger.info("settings.update.succeeded", { userId });
    revalidatePath("/");
    revalidatePath("/settings");
    return { status: "success", message: "Settings saved." };
  } catch (error) {
    logger.error("settings.update.failed", { userId, error });
    return { status: "error", message: "Unable to save settings." };
  }
};

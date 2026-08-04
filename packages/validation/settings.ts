import { z } from "zod";

export const settingsSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
});

export type SettingsInput = z.infer<typeof settingsSchema>;

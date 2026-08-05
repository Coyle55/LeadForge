import { z } from "zod";

const isoDatetimeWithOffsetSchema = z.iso
  .datetime({ offset: true })
  .transform((value, context) => {
    const dueAt = new Date(value);

    if (Number.isNaN(dueAt.getTime())) {
      context.addIssue({
        code: "custom",
        message: "Enter a valid due date and time",
      });
      return z.NEVER;
    }

    return dueAt;
  });

export const taskInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  dueAt: isoDatetimeWithOffsetSchema,
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]),
});

export type TaskInput = z.infer<typeof taskInputSchema>;

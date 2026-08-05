import { z } from "zod";

export {
  type DealEditInput,
  dealEditSchema,
  type PipelineTransitionInput,
  pipelineTransitionSchema,
} from "./pipeline";
export { type ProspectInput, prospectSchema } from "./prospect";
export { type SettingsInput, settingsSchema } from "./settings";
export { type TaskInput, taskInputSchema } from "./tasks";

const unsupportedControlCharacters =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: This intentionally rejects every C0 control character except tab and newline.
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;

const plainText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine(
      (value) => !unsupportedControlCharacters.test(value),
      "Unsupported control character"
    );

export const outreachProfileSchema = z
  .object({
    senderName: plainText(1, 80),
    companyName: plainText(1, 120),
    serviceOffered: plainText(10, 300),
    valueProposition: plainText(20, 600),
    defaultCta: plainText(10, 240),
  })
  .strict();

export const outreachDraftEditSchema = z
  .object({
    subject: plainText(3, 120),
    body: plainText(40, 2000),
  })
  .strict();

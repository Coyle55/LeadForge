import { z } from "zod";
import type { OutreachOutput } from "./types";

const unsupportedControlCharacters =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: This intentionally rejects every C0 control character except tab and newline.
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;
const markdownHeading = /^\s{0,3}#{1,6}\s+/mu;
const markdownLink = /\[[^\]]+\]\([^)]+\)|\[[^\]]+\]\[[^\]]*\]/u;
const htmlTag = /<\/?[a-z][^>]*>/iu;

const plainText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine(
      (value) => !unsupportedControlCharacters.test(value),
      "Unsupported control character"
    )
    .refine(
      (value) => !markdownHeading.test(value),
      "Markdown headings are not allowed"
    )
    .refine(
      (value) => !markdownLink.test(value),
      "Markdown links are not allowed"
    )
    .refine((value) => !htmlTag.test(value), "HTML tags are not allowed");

export const outreachOutputSchema = z
  .object({
    subject: plainText(3, 120),
    body: plainText(40, 2000),
  })
  .strict();

export const validateOutreachOutput = (output: unknown): OutreachOutput =>
  outreachOutputSchema.parse(output);

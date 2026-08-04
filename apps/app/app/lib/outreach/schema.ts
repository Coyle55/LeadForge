import { z } from "zod";
import type { OutreachOutput } from "./types";

const unsupportedControlCharacters =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: This intentionally rejects every C0/C1 control character except tab, newline, and carriage return.
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;
const markdownHeading = /^\s{0,3}#{1,6}\s+/mu;
const markdownLink = /\[[^\]]*\]\([^)]*\)|\[[^\]]*\]\[[^\]]*\]/u;
const markdownCodeFence = /^\s{0,3}(?:`{3,}|~{3,})/mu;
const markdownInlineCode = /(^|[^`])`[^`\r\n]+`(?!`)/u;
const markdownStrong = /(\*\*|__)(?=\S)[^\r\n]*?\S\1/u;
const markdownEmphasis =
  /(^|[\s([{])([*_])(?=\S)[^*_\r\n]*?\S\2(?=$|[\s)\]},.!?;:])/u;
const markdownStrikethrough = /~~(?=\S)[^\r\n]*?\S~~/u;
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
    .refine(
      (value) =>
        !(
          markdownCodeFence.test(value) ||
          markdownInlineCode.test(value) ||
          markdownStrong.test(value) ||
          markdownEmphasis.test(value) ||
          markdownStrikethrough.test(value)
        ),
      "Markdown decoration is not allowed"
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

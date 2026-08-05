import { z } from "zod";
import type { InterpretationOutput } from "./types";

const recommendationCopySchema = z.object({
  serviceCategory: z.enum([
    "WEBSITE_REDESIGN",
    "PERFORMANCE_OPTIMIZATION",
    "BOOKING_INTEGRATION",
    "LEAD_CAPTURE_REPAIR",
    "LEAD_RESPONSE_AUTOMATION",
  ]),
  title: z.string().min(5).max(120),
  rationale: z.string().min(20).max(500),
  action: z.string().min(20).max(500),
});

export const interpretationOutputSchema = z
  .object({
    summary: z.string().min(40).max(700),
    strongestIssue: z.string().min(10).max(200),
    practicalImpact: z.string().min(20).max(500),
    suggestedOffer: z.string().min(10).max(300),
    confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
    warnings: z.array(z.string().min(5).max(300)).max(5),
    recommendations: z.array(recommendationCopySchema).max(2),
  })
  .strict();

const numberPattern = /-?\d+(\.\d+)?%?/g;

export const validateInterpretationOutput = (
  output: unknown,
  allowedNumbers: Set<string>,
  expectedServiceCategories: string[]
): InterpretationOutput => {
  const parsed = interpretationOutputSchema.parse(output);

  const returned = parsed.recommendations.map((r) => r.serviceCategory);
  const returnedSet = new Set<string>(returned);
  const expectedSet = new Set(expectedServiceCategories);
  const isExactMatch =
    returnedSet.size === returned.length &&
    returnedSet.size === expectedSet.size &&
    [...expectedSet].every((category) => returnedSet.has(category));
  if (!isExactMatch) {
    throw new Error(
      "Interpretation recommendations do not match the expected service categories"
    );
  }

  const text = [
    parsed.summary,
    parsed.strongestIssue,
    parsed.practicalImpact,
    parsed.suggestedOffer,
    ...parsed.recommendations.flatMap((r) => [r.title, r.rationale, r.action]),
  ].join(" ");
  const found = text.match(numberPattern) ?? [];
  for (const value of found) {
    const normalized = value.replace(/%$/, "");
    if (!(allowedNumbers.has(value) || allowedNumbers.has(normalized))) {
      throw new Error(`Interpretation introduced an unlisted number: ${value}`);
    }
  }
  return parsed;
};

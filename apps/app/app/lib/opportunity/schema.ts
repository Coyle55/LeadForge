import { z } from "zod";
import type { OpportunityOutput } from "./types";

const score = z.number().int().min(0).max(100);
const recommendation = z.object({
  title: z.string().min(5).max(120),
  impact: z.enum(["HIGH", "MEDIUM", "LOW"]),
  effort: z.enum(["HIGH", "MEDIUM", "LOW"]),
  rationale: z.string().min(20).max(800),
  action: z.string().min(20).max(800),
  auditCheckKeys: z
    .array(z.string().min(1))
    .min(1)
    .max(5)
    .refine((keys) => new Set(keys).size === keys.length),
});

export const opportunityOutputSchema = z
  .object({
    overallScore: score,
    categoryScores: z
      .object({
        accessibility: score,
        trust: score,
        seo: score,
        technical: score,
        performance: score,
      })
      .strict(),
    executiveSummary: z.string().min(40).max(700),
    overallRationale: z.string().min(40).max(1000),
    recommendations: z.array(recommendation).min(3).max(7),
  })
  .strict();

export const validateOpportunityOutput = (
  output: unknown,
  validCheckKeys: Set<string>
): OpportunityOutput => {
  const parsed = opportunityOutputSchema.parse(output);
  const titles = parsed.recommendations.map(({ title }) =>
    title.trim().toLowerCase()
  );
  if (new Set(titles).size !== titles.length) {
    throw new Error("Duplicate recommendation title");
  }
  if (
    parsed.recommendations.some(({ auditCheckKeys }) =>
      auditCheckKeys.some((key) => !validCheckKeys.has(key))
    )
  ) {
    throw new Error("Unknown audit evidence reference");
  }
  return parsed;
};

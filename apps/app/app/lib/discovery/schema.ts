import { z } from "zod";

export const rawCandidateSchema = z.object({
  businessName: z.string().trim().min(1),
  category: z.string().trim().min(1).optional(),
  websiteUrl: z.string().trim().min(1).optional(),
  phone: z.string().trim().min(1).optional(),
  formattedAddress: z.string().trim().min(1).optional(),
  city: z.string().trim().min(1).optional(),
  state: z.string().trim().min(1).optional(),
  sourceUrls: z.array(z.string().trim().min(1)).min(1),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  providerCandidateId: z.string().trim().min(1).optional(),
});
export type RawCandidate = z.infer<typeof rawCandidateSchema>;

export const discoveryModelOutputSchema = z.object({
  candidates: z.array(z.record(z.string(), z.unknown())).max(25),
});

export const validateCandidate = (
  raw: unknown
): { ok: true; value: RawCandidate } | { ok: false; reason: string } => {
  const parsed = rawCandidateSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      reason: `${issue.path.join(".") || "candidate"}: ${issue.message}`,
    };
  }
  return { ok: true, value: parsed.data };
};

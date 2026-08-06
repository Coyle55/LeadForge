import { z } from "zod";

// LLMs commonly emit "" for a field they don't have a confident value for,
// rather than omitting the key entirely. Treat an empty (or whitespace-only)
// string as equivalent to the field being absent instead of failing
// validation for the whole candidate.
const optionalNonEmptyString = () =>
  z.preprocess(
    (val) => (typeof val === "string" && val.trim() === "" ? undefined : val),
    z.string().trim().min(1).optional()
  );

export const rawCandidateSchema = z.object({
  businessName: z.string().trim().min(1),
  category: optionalNonEmptyString(),
  websiteUrl: optionalNonEmptyString(),
  phone: optionalNonEmptyString(),
  formattedAddress: optionalNonEmptyString(),
  city: optionalNonEmptyString(),
  state: optionalNonEmptyString(),
  sourceUrls: z.array(z.string().trim().min(1)).min(1),
  // Nothing constrains the model to always emit a valid confidence value.
  // Rather than rejecting an otherwise-valid candidate over this field,
  // fall back to "LOW" for a missing or invalid value.
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]).catch("LOW"),
  providerCandidateId: z.string().trim().min(1).optional(),
});
export type RawCandidate = z.infer<typeof rawCandidateSchema>;

// Candidate elements are validated individually via `validateCandidate`
// below, so the outer schema only needs to confirm `candidates` is an array
// -- it must not reject the whole response just because one element isn't a
// plain object (e.g. `null` or a bare string). A single non-object element
// is instead reported as a per-candidate rejection reason.
export const discoveryModelOutputSchema = z.object({
  candidates: z.array(z.unknown()).max(25),
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

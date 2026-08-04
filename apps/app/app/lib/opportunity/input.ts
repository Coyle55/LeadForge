type Primitive = boolean | number | string | null;

const primitiveEvidence = (evidence: unknown) => {
  if (!(evidence && typeof evidence === "object" && !Array.isArray(evidence))) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(evidence)
      .filter((entry): entry is [string, Primitive] => {
        const value = entry[1];
        return (
          value === null ||
          ["boolean", "number", "string"].includes(typeof value)
        );
      })
      .slice(0, 20)
      .map(([key, value]) => [
        key,
        typeof value === "string" ? value.slice(0, 300) : value,
      ])
  );
};

export const buildOpportunityInput = ({
  prospectName,
  requestedUrl,
  audit,
  checks,
}: {
  prospectName: string;
  requestedUrl: string;
  audit: {
    createdAt: Date;
    pagesAudited: number;
    pagesAttempted: number;
    durationMs: number | null;
  };
  checks: Array<{
    key: string;
    category: string;
    status: string;
    summary: string;
    evidence: unknown;
  }>;
}) => ({
  prospectName: prospectName.slice(0, 160),
  hostname: new URL(requestedUrl).hostname,
  audit: {
    auditedAt: audit.createdAt.toISOString(),
    pagesAudited: audit.pagesAudited,
    pagesAttempted: audit.pagesAttempted,
    durationMs: audit.durationMs,
  },
  checks: checks.slice(0, 100).map((check) => ({
    key: check.key,
    category: check.category,
    status: check.status,
    summary: check.summary.slice(0, 500),
    evidence: primitiveEvidence(check.evidence),
  })),
});

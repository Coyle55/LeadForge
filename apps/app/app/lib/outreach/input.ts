import type { OutreachInput, OutreachPrimitive } from "./types";

const OUTREACH_INPUT_LIMITS = {
  recipientFirstName: 80,
  businessName: 160,
  hostname: 253,
  recommendationTitle: 120,
  recommendationText: 800,
  auditKey: 100,
  auditLabel: 120,
  auditStatus: 20,
  auditSummary: 500,
  evidenceKey: 100,
  evidenceString: 300,
  senderName: 80,
  companyName: 120,
  serviceOffered: 300,
  valueProposition: 600,
  defaultCta: 240,
} as const;

const whitespace = /\s+/;

const bounded = (value: string, limit: number) => value.slice(0, limit);

type WithAdditionalFields<T> = T & Record<string, unknown>;

const primitiveEvidence = (
  evidence: unknown
): Record<string, OutreachPrimitive> => {
  if (!(evidence && typeof evidence === "object" && !Array.isArray(evidence))) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(evidence)
      .filter((entry): entry is [string, OutreachPrimitive] => {
        const value = entry[1];
        return (
          value === null ||
          ["boolean", "number", "string"].includes(typeof value)
        );
      })
      .slice(0, 20)
      .map(([key, value]) => [
        bounded(key, OUTREACH_INPUT_LIMITS.evidenceKey),
        typeof value === "string"
          ? bounded(value, OUTREACH_INPUT_LIMITS.evidenceString)
          : value,
      ])
  );
};

export const buildOutreachInput = ({
  prospect,
  recommendation,
  checks,
  sender,
}: {
  prospect: WithAdditionalFields<{
    contactName: string;
    name: string;
    requestedUrl: string;
  }>;
  recommendation: WithAdditionalFields<{
    title: string;
    rationale: string;
    action: string;
    auditCheckKeys: string[];
  }>;
  checks: WithAdditionalFields<{
    key: string;
    label: string;
    status: string;
    summary: string;
    evidence: unknown;
  }>[];
  sender: WithAdditionalFields<{
    senderName: string;
    companyName: string;
    serviceOffered: string;
    valueProposition: string;
    defaultCta: string;
  }>;
}): OutreachInput => {
  const auditCheckKeys = new Set(recommendation.auditCheckKeys);

  return {
    recipientFirstName: bounded(
      prospect.contactName.split(whitespace).find(Boolean) ?? "",
      OUTREACH_INPUT_LIMITS.recipientFirstName
    ),
    businessName: bounded(prospect.name, OUTREACH_INPUT_LIMITS.businessName),
    hostname: bounded(
      new URL(prospect.requestedUrl).hostname,
      OUTREACH_INPUT_LIMITS.hostname
    ),
    recommendation: {
      title: bounded(
        recommendation.title,
        OUTREACH_INPUT_LIMITS.recommendationTitle
      ),
      rationale: bounded(
        recommendation.rationale,
        OUTREACH_INPUT_LIMITS.recommendationText
      ),
      action: bounded(
        recommendation.action,
        OUTREACH_INPUT_LIMITS.recommendationText
      ),
    },
    evidence: checks
      .filter((check) => auditCheckKeys.has(check.key))
      .slice(0, 20)
      .map((check) => ({
        key: bounded(check.key, OUTREACH_INPUT_LIMITS.auditKey),
        label: bounded(check.label, OUTREACH_INPUT_LIMITS.auditLabel),
        status: bounded(check.status, OUTREACH_INPUT_LIMITS.auditStatus),
        summary: bounded(check.summary, OUTREACH_INPUT_LIMITS.auditSummary),
        evidence: primitiveEvidence(check.evidence),
      })),
    sender: {
      senderName: bounded(sender.senderName, OUTREACH_INPUT_LIMITS.senderName),
      companyName: bounded(
        sender.companyName,
        OUTREACH_INPUT_LIMITS.companyName
      ),
      serviceOffered: bounded(
        sender.serviceOffered,
        OUTREACH_INPUT_LIMITS.serviceOffered
      ),
      valueProposition: bounded(
        sender.valueProposition,
        OUTREACH_INPUT_LIMITS.valueProposition
      ),
      defaultCta: bounded(sender.defaultCta, OUTREACH_INPUT_LIMITS.defaultCta),
    },
  };
};

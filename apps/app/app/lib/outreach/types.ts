export type OutreachPrimitive = boolean | number | string | null;

export interface OutreachInput {
  businessName: string;
  evidence: {
    key: string;
    label: string;
    status: string;
    summary: string;
    evidence: Record<string, OutreachPrimitive>;
  }[];
  hostname: string;
  recipientFirstName: string;
  recommendation: {
    title: string;
    rationale: string;
    action: string;
  };
  sender: {
    senderName: string;
    companyName: string;
    serviceOffered: string;
    valueProposition: string;
    defaultCta: string;
  };
}

export interface OutreachOutput {
  body: string;
  subject: string;
}

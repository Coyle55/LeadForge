export type ResolveHostname = (hostname: string) => Promise<string[]>;

export interface AuditDependencies {
  fetch?: typeof fetch;
  now?: () => number;
  resolveHostname: ResolveHostname;
}

export type AuditCategory =
  | "ACCESSIBILITY"
  | "TRUST"
  | "SEO"
  | "TECHNICAL"
  | "PERFORMANCE";

export type AuditStatus = "PASS" | "WARNING" | "FAIL";

export interface AuditFinding {
  category: AuditCategory;
  evidence: Record<string, string | number | boolean | null>;
  key: string;
  label: string;
  status: AuditStatus;
  summary: string;
}

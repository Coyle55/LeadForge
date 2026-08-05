import type { ScreenshotProvider } from "./screenshot";

export type ResolveHostname = (hostname: string) => Promise<string[]>;

export interface AuditDependencies {
  fetch?: typeof fetch;
  now?: () => number;
  resolveHostname: ResolveHostname;
  screenshotProvider?: ScreenshotProvider;
}

export type AuditCategory =
  | "ACCESSIBILITY"
  | "TRUST"
  | "SEO"
  | "TECHNICAL"
  | "PERFORMANCE"
  | "BOOKING";

export type AuditStatus = "PASS" | "WARNING" | "FAIL";

export interface AuditFinding {
  category: AuditCategory;
  evidence: Record<string, string | number | boolean | null>;
  key: string;
  label: string;
  status: AuditStatus;
  summary: string;
}

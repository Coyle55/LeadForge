import { describe, expect, it } from "vitest";
import { buildOpportunityInput } from "./input";

describe("buildOpportunityInput", () => {
  it("minimizes website and audit evidence for the model", () => {
    const result = buildOpportunityInput({
      prospectName: "Acme Plumbing",
      requestedUrl: "https://user:secret@example.com/path?token=private#x",
      audit: { createdAt: new Date("2026-08-04T12:00:00Z"), pagesAudited: 2, pagesAttempted: 3, durationMs: 400 },
      checks: [{ key: "https", category: "TRUST", status: "PASS", summary: "Secure", evidence: { secure: true, count: 2, nested: { secret: true }, long: "x".repeat(1000) } }],
    });
    expect(result).toEqual({
      prospectName: "Acme Plumbing",
      hostname: "example.com",
      audit: { auditedAt: "2026-08-04T12:00:00.000Z", pagesAudited: 2, pagesAttempted: 3, durationMs: 400 },
      checks: [{ key: "https", category: "TRUST", status: "PASS", summary: "Secure", evidence: { secure: true, count: 2, long: "x".repeat(300) } }],
    });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("token");
  });
});

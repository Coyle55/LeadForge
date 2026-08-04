import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const prospectFindMock = vi.fn();
const auditFindMock = vi.fn();
const auditCreateMock = vi.fn();
const auditUpdateMock = vi.fn();
const checkCreateManyMock = vi.fn();
const transactionMock = vi.fn();
const runMock = vi.fn();
const redirectMock = vi.fn();

vi.mock("@repo/auth/server", () => ({ auth: authMock }));
vi.mock("@repo/auth", () => ({
  isAllowedUserId: (id: string) => id === "user_owner",
}));
vi.mock("@repo/audit-engine", () => ({
  runWebsiteAudit: runMock,
  AuditEngineError: class AuditEngineError extends Error {
    code: string;
    constructor(code: string) {
      super("safe");
      this.code = code;
    }
  },
}));
vi.mock("@repo/database", () => ({
  database: {
    prospect: { findFirst: prospectFindMock },
    websiteAudit: {
      findFirst: auditFindMock,
      create: auditCreateMock,
      update: auditUpdateMock,
    },
    auditCheck: { createMany: checkCreateManyMock },
    $transaction: transactionMock,
  },
}));
vi.mock("@repo/observability", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

describe("runProspectAudit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auditFindMock.mockResolvedValue(null);
  });

  it("rejects unauthorized and other-owner prospects before running", async () => {
    const { runProspectAudit } = await import("./audits");
    authMock.mockResolvedValueOnce({ userId: null });
    await expect(runProspectAudit("prospect_1")).resolves.toMatchObject({
      status: "error",
    });
    authMock.mockResolvedValueOnce({ userId: "user_owner" });
    prospectFindMock.mockResolvedValueOnce(null);
    await expect(runProspectAudit("prospect_other")).resolves.toMatchObject({
      status: "error",
    });
    expect(runMock).not.toHaveBeenCalled();
  });

  it("persists a completed audit for the authenticated owner", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    prospectFindMock.mockResolvedValue({
      id: "prospect_1",
      websiteUrl: "https://example.com",
    });
    auditCreateMock.mockResolvedValue({ id: "audit_1" });
    runMock.mockResolvedValue({
      requestedUrl: "https://example.com/",
      finalUrl: "https://example.com/",
      pagesAttempted: 1,
      pagesAudited: 1,
      durationMs: 100,
      checks: [
        {
          key: "https",
          category: "TRUST",
          label: "HTTPS",
          status: "PASS",
          summary: "safe",
          evidence: { secure: true },
        },
      ],
    });
    transactionMock.mockResolvedValue([]);
    const { runProspectAudit } = await import("./audits");
    await runProspectAudit("prospect_1");
    expect(prospectFindMock).toHaveBeenCalledWith({
      where: { id: "prospect_1", userId: "user_owner" },
      select: { id: true, websiteUrl: true },
    });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: {
        userId: "user_owner",
        prospectId: "prospect_1",
        requestedUrl: "https://example.com",
      },
      select: { id: true },
    });
    expect(transactionMock).toHaveBeenCalled();
    expect(redirectMock).toHaveBeenCalledWith("/audits/audit_1");
  });

  it("stores a safe failed state when the engine rejects the target", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    prospectFindMock.mockResolvedValue({
      id: "prospect_1",
      websiteUrl: "http://localhost",
    });
    auditCreateMock.mockResolvedValue({ id: "audit_1" });
    runMock.mockRejectedValue(
      Object.assign(new Error("secret host"), { code: "BLOCKED_TARGET" })
    );
    auditUpdateMock.mockResolvedValue({});
    const { runProspectAudit } = await import("./audits");
    await runProspectAudit("prospect_1");
    expect(auditUpdateMock).toHaveBeenCalledWith({
      where: { id: "audit_1" },
      data: expect.objectContaining({
        status: "FAILED",
        failureCode: "BLOCKED_TARGET",
        failureMessage: "The website target is not publicly reachable.",
      }),
    });
    expect(redirectMock).toHaveBeenCalledWith("/audits/audit_1");
  });
});

import { describe, expect, it } from "vitest";
import { AuditEngineError } from "./errors";
import { validatePublicTarget } from "./target-policy";

const resolvePublic = async () => ["93.184.216.34"];

describe("validatePublicTarget", () => {
  it.each([
    "ftp://example.com",
    "https://user:pass@example.com",
    "http://localhost",
    "http://127.0.0.1",
    "http://10.0.0.1",
    "http://169.254.1.1",
    "http://[::1]",
    "http://[fc00::1]",
  ])("rejects unsafe target %s", async (input) => {
    await expect(
      validatePublicTarget(input, { resolveHostname: resolvePublic })
    ).rejects.toBeInstanceOf(AuditEngineError);
  });

  it("rejects a hostname when any DNS answer is private", async () => {
    await expect(
      validatePublicTarget("https://example.com", {
        resolveHostname: async () => ["93.184.216.34", "192.168.1.2"],
      })
    ).rejects.toMatchObject({ code: "BLOCKED_TARGET" });
  });

  it("normalizes an allowed public target", async () => {
    const result = await validatePublicTarget("https://Example.com/path#x", {
      resolveHostname: resolvePublic,
    });
    expect(result.href).toBe("https://example.com/path");
  });
});

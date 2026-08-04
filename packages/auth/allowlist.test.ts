import { describe, expect, it, vi } from "vitest";
import { isAllowedUserId } from "./allowlist";

describe("isAllowedUserId", () => {
  it("allows an exact configured Clerk user ID", () => {
    expect(isAllowedUserId("user_owner", "user_other, user_owner")).toBe(true);
  });

  it("rejects substrings and unconfigured users", () => {
    expect(isAllowedUserId("user_own", "user_owner")).toBe(false);
    expect(isAllowedUserId("user_other", "user_owner")).toBe(false);
  });

  it("trims entries and ignores duplicates", () => {
    expect(isAllowedUserId("user_owner", " user_owner, user_owner ")).toBe(
      true
    );
  });

  it("fails closed when configuration is empty", () => {
    vi.stubEnv("ALLOWED_USER_IDS", "");
    expect(isAllowedUserId("user_owner", undefined)).toBe(false);
    expect(isAllowedUserId("user_owner", " , ")).toBe(false);
    vi.unstubAllEnvs();
  });
});

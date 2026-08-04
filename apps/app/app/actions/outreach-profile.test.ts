import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const upsertMock = vi.fn();
const logErrorMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@repo/auth/server", () => ({ auth: authMock }));
vi.mock("@repo/auth", () => ({
  isAllowedUserId: (userId: string) => userId === "user_owner",
}));
vi.mock("@repo/database", () => ({
  database: { outreachProfile: { upsert: upsertMock } },
}));
vi.mock("@repo/observability", () => ({
  logger: { info: vi.fn(), error: logErrorMock },
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

const validValues = {
  senderName: "Casey",
  companyName: "LeadForge",
  serviceOffered: "Website conversion improvements",
  valueProposition: "Turn high-intent visits into more qualified inquiries.",
  defaultCta: "Worth a quick reply if this is a priority?",
};

const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    data.set(key, value);
  }
  return data;
};

describe("updateOutreachProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ALLOWED_USER_IDS = "user_owner";
  });

  it("rejects signed-out and non-owner callers without writing", async () => {
    const { updateOutreachProfile } = await import("./outreach-profile");
    authMock.mockResolvedValueOnce({ userId: null });
    await expect(
      updateOutreachProfile({}, form(validValues))
    ).resolves.toEqual({ status: "error", message: "Not authorized." });
    authMock.mockResolvedValueOnce({ userId: "user_other" });
    await expect(
      updateOutreachProfile({}, form(validValues))
    ).resolves.toEqual({ status: "error", message: "Not authorized." });
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("upserts trimmed profile values for the authenticated owner only", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    upsertMock.mockResolvedValue({ id: "profile_1" });
    const { updateOutreachProfile } = await import("./outreach-profile");

    await expect(
      updateOutreachProfile(
        {},
        form({
          ...validValues,
          senderName: "  Casey  ",
          userId: "user_victim",
        })
      )
    ).resolves.toEqual({
      status: "success",
      message: "Outreach profile saved.",
    });

    expect(upsertMock).toHaveBeenCalledWith({
      where: { userId: "user_owner" },
      create: { userId: "user_owner", ...validValues },
      update: validValues,
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/settings");
  });

  it("returns a validation error without writing malformed profile values", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    const { updateOutreachProfile } = await import("./outreach-profile");

    await expect(
      updateOutreachProfile(
        {},
        form({ ...validValues, valueProposition: "Too short" })
      )
    ).resolves.toEqual({
      status: "error",
      message: "Outreach profile must contain valid values.",
    });
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("returns a safe database error and logs only the owner metadata", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    upsertMock.mockRejectedValue(new Error("database password leaked"));
    const { updateOutreachProfile } = await import("./outreach-profile");

    await expect(
      updateOutreachProfile({}, form(validValues))
    ).resolves.toEqual({
      status: "error",
      message: "Unable to save outreach profile.",
    });
    expect(logErrorMock).toHaveBeenCalledWith("outreach_profile.update.failed", {
      userId: "user_owner",
    });
  });
});

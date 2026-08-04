import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const updateMock = vi.fn();
const logErrorMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@repo/auth/server", () => ({ auth: authMock }));
vi.mock("@repo/auth", () => ({
  isAllowedUserId: (userId: string) => userId === "user_owner",
}));
vi.mock("@repo/database", () => ({
  database: { user: { update: updateMock } },
}));
vi.mock("@repo/observability", () => ({
  logger: { info: vi.fn(), error: logErrorMock },
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

const form = (displayName: string, userId?: string) => {
  const data = new FormData();
  data.set("displayName", displayName);
  if (userId) {
    data.set("userId", userId);
  }
  return data;
};

describe("updateDisplayName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ALLOWED_USER_IDS = "user_owner";
  });

  it("rejects signed-out and non-owner callers without writing", async () => {
    const { updateDisplayName } = await import("./settings");
    authMock.mockResolvedValueOnce({ userId: null });
    await expect(updateDisplayName({}, form("Owner"))).resolves.toMatchObject({
      status: "error",
    });
    authMock.mockResolvedValueOnce({ userId: "user_other" });
    await expect(updateDisplayName({}, form("Owner"))).resolves.toMatchObject({
      status: "error",
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("scopes the update to auth userId and ignores a submitted userId", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    updateMock.mockResolvedValue({ id: "user_owner" });
    const { updateDisplayName } = await import("./settings");

    await expect(
      updateDisplayName({}, form("  Ada  ", "user_victim"))
    ).resolves.toEqual({
      status: "success",
      message: "Settings saved.",
    });
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "user_owner" },
      data: { displayName: "Ada" },
    });
  });

  it.each([
    "",
    "   ",
    "x".repeat(81),
  ])("rejects invalid displayName input", async (name) => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    const { updateDisplayName } = await import("./settings");

    await expect(updateDisplayName({}, form(name))).resolves.toMatchObject({
      status: "error",
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns a safe error and logs database failures", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    updateMock.mockRejectedValue(new Error("database password leaked"));
    const { updateDisplayName } = await import("./settings");

    await expect(updateDisplayName({}, form("Ada"))).resolves.toEqual({
      status: "error",
      message: "Unable to save settings.",
    });
    expect(logErrorMock).toHaveBeenCalledWith(
      "settings.update.failed",
      expect.objectContaining({ userId: "user_owner" })
    );
  });
});

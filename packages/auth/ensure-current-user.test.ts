import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const currentUserMock = vi.fn();
const upsertMock = vi.fn();
const logErrorMock = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  auth: authMock,
  currentUser: currentUserMock,
}));
vi.mock("@repo/database", () => ({
  database: { user: { upsert: upsertMock } },
}));
vi.mock("@repo/observability", () => ({
  logger: { info: vi.fn(), error: logErrorMock },
}));

describe("ensureCurrentUser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects signed-out callers without resolving or writing a user", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { ensureCurrentUser } = await import("./ensure-current-user");

    await expect(ensureCurrentUser()).rejects.toThrow(
      "Authentication required"
    );
    expect(currentUserMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("upserts the authenticated ID and current primary email", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    currentUserMock.mockResolvedValue({
      id: "user_owner",
      primaryEmailAddressId: "email_primary",
      emailAddresses: [
        { id: "email_secondary", emailAddress: "other@example.com" },
        { id: "email_primary", emailAddress: "owner@example.com" },
      ],
    });
    const localUser = { id: "user_owner", email: "owner@example.com" };
    upsertMock.mockResolvedValue(localUser);
    const { ensureCurrentUser } = await import("./ensure-current-user");

    await expect(ensureCurrentUser()).resolves.toEqual(localUser);
    expect(upsertMock).toHaveBeenCalledWith({
      where: { id: "user_owner" },
      create: { id: "user_owner", email: "owner@example.com" },
      update: { email: "owner@example.com" },
    });
  });

  it("fails safely when no primary email is available", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    currentUserMock.mockResolvedValue({
      id: "user_owner",
      primaryEmailAddressId: null,
      emailAddresses: [],
    });
    const { ensureCurrentUser } = await import("./ensure-current-user");

    await expect(ensureCurrentUser()).rejects.toThrow("Primary email required");
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("logs database failures without changing the safe thrown message", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    currentUserMock.mockResolvedValue({
      id: "user_owner",
      primaryEmailAddressId: "email_primary",
      emailAddresses: [
        { id: "email_primary", emailAddress: "owner@example.com" },
      ],
    });
    upsertMock.mockRejectedValue(new Error("database password leaked"));
    const { ensureCurrentUser } = await import("./ensure-current-user");

    await expect(ensureCurrentUser()).rejects.toThrow(
      "Unable to synchronize user"
    );
    expect(logErrorMock).toHaveBeenCalledWith(
      "user.ensure.failed",
      expect.objectContaining({ userId: "user_owner" })
    );
  });
});

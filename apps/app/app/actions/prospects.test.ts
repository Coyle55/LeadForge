import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const createMock = vi.fn();
const updateManyMock = vi.fn();
const logErrorMock = vi.fn();
const revalidatePathMock = vi.fn();
const redirectMock = vi.fn();

vi.mock("@repo/auth/server", () => ({ auth: authMock }));
vi.mock("@repo/auth", () => ({
  isAllowedUserId: (userId: string) => userId === "user_owner",
}));
vi.mock("@repo/database", () => ({
  database: {
    prospect: { create: createMock, updateMany: updateManyMock },
  },
}));
vi.mock("@repo/observability", () => ({
  logger: { info: vi.fn(), error: logErrorMock },
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    data.set(key, value);
  }
  return data;
};

const valid = {
  businessName: "Acme Plumbing",
  websiteUrl: "acme.example",
  contactName: " Ada ",
  contactEmail: " OWNER@EXAMPLE.COM ",
  phone: "",
  location: "Boston",
  notes: "",
};

describe("prospect actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ALLOWED_USER_IDS = "user_owner";
  });

  it("denies signed-out and non-owner creation without writing", async () => {
    const { createProspect } = await import("./prospects");
    authMock.mockResolvedValueOnce({ userId: null });
    await expect(createProspect({}, form(valid))).resolves.toMatchObject({
      status: "error",
    });
    authMock.mockResolvedValueOnce({ userId: "user_other" });
    await expect(createProspect({}, form(valid))).resolves.toMatchObject({
      status: "error",
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("creates for the authenticated owner and normalizes fields", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    createMock.mockResolvedValue({ id: "prospect_1" });
    const { createProspect } = await import("./prospects");

    await createProspect({}, form({ ...valid, userId: "user_victim" }));
    expect(createMock).toHaveBeenCalledWith({
      data: {
        userId: "user_owner",
        businessName: "Acme Plumbing",
        websiteUrl: "https://acme.example",
        contactName: "Ada",
        contactEmail: "owner@example.com",
        phone: null,
        location: "Boston",
        notes: null,
      },
    });
    expect(redirectMock).toHaveBeenCalledWith(
      "/prospects/prospect_1?created=1"
    );
  });

  it("returns field errors for invalid input", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    const { createProspect } = await import("./prospects");

    const result = await createProspect(
      {},
      form({ ...valid, businessName: "", websiteUrl: "ftp://bad" })
    );
    expect(result).toMatchObject({ status: "error" });
    expect(result.fieldErrors).toHaveProperty("businessName");
    expect(result.fieldErrors).toHaveProperty("websiteUrl");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("updates with an owner-scoped predicate and ignores submitted owner", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    updateManyMock.mockResolvedValue({ count: 1 });
    const { updateProspect } = await import("./prospects");

    await updateProspect(
      {},
      form({ ...valid, prospectId: "prospect_1", userId: "user_victim" })
    );
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: "prospect_1", userId: "user_owner" },
      data: expect.objectContaining({ businessName: "Acme Plumbing" }),
    });
  });

  it("returns the same safe error for missing or cross-owner updates", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    updateManyMock.mockResolvedValue({ count: 0 });
    const { updateProspect } = await import("./prospects");

    await expect(
      updateProspect({}, form({ ...valid, prospectId: "prospect_other" }))
    ).resolves.toEqual({ status: "error", message: "Prospect not found." });
  });

  it.each([
    ["archiveProspect", "ARCHIVED"],
    ["restoreProspect", "NEW"],
  ])("%s changes status with owner scope", async (actionName, status) => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    updateManyMock.mockResolvedValue({ count: 1 });
    const actions = await import("./prospects");

    const result =
      await actions[actionName as "archiveProspect" | "restoreProspect"](
        "prospect_1"
      );
    expect(result).toEqual({
      status: "success",
      message:
        status === "ARCHIVED" ? "Prospect archived." : "Prospect restored.",
    });
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: "prospect_1", userId: "user_owner" },
      data: { status },
    });
  });

  it("returns a safe database error and logs metadata only", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    createMock.mockRejectedValue(new Error("database password leaked"));
    const { createProspect } = await import("./prospects");

    await expect(createProspect({}, form(valid))).resolves.toEqual({
      status: "error",
      message: "Unable to save prospect.",
    });
    expect(logErrorMock).toHaveBeenCalledWith(
      "prospect.create.failed",
      expect.objectContaining({ userId: "user_owner" })
    );
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const createMock = vi.fn();
const updateManyMock = vi.fn();
const logInfoMock = vi.fn();
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
  logger: { info: logInfoMock, error: logErrorMock },
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
    expect(revalidatePathMock).toHaveBeenCalledWith("/prospects");
    expect(revalidatePathMock).toHaveBeenCalledWith("/pipeline");
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

  it("archives with owner scope and a single server timestamp", async () => {
    const startedAt = Date.now();
    authMock.mockResolvedValue({ userId: "user_owner" });
    updateManyMock.mockResolvedValue({ count: 1 });
    const actions = await import("./prospects");

    const result = await actions.archiveProspect("prospect_1");
    expect(result).toEqual({
      status: "success",
      message: "Prospect archived.",
    });
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: "prospect_1", userId: "user_owner" },
      data: { archivedAt: expect.any(Date) },
    });
    const archivedAt = updateManyMock.mock.calls[0]?.[0]?.data.archivedAt;
    expect(archivedAt.getTime()).toBeGreaterThanOrEqual(startedAt);
    expect(archivedAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(revalidatePathMock).toHaveBeenCalledWith("/prospects");
    expect(revalidatePathMock).toHaveBeenCalledWith("/pipeline");
    expect(revalidatePathMock).toHaveBeenCalledWith("/prospects/prospect_1");
  });

  it("restores with owner scope and clears only archive state", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    updateManyMock.mockResolvedValue({ count: 1 });
    const { restoreProspect } = await import("./prospects");

    await expect(restoreProspect("prospect_1")).resolves.toEqual({
      status: "success",
      message: "Prospect restored.",
    });
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: "prospect_1", userId: "user_owner" },
      data: { archivedAt: null },
    });
  });

  it("returns a safe database error and logs sanitized metadata only", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    createMock.mockRejectedValue(new Error("database password leaked"));
    const { createProspect } = await import("./prospects");

    await expect(createProspect({}, form(valid))).resolves.toEqual({
      status: "error",
      message: "Unable to save prospect.",
    });
    expect(logErrorMock).toHaveBeenCalledWith("prospect.create.failed", {
      userId: "user_owner",
    });
  });

  it("does not log raw errors when archive persistence fails", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    updateManyMock.mockRejectedValue(new Error("database password leaked"));
    const { archiveProspect } = await import("./prospects");

    await expect(archiveProspect("prospect_1")).resolves.toEqual({
      status: "error",
      message: "Unable to update prospect.",
    });
    expect(logErrorMock).toHaveBeenCalledWith("prospect.archive_state.failed", {
      userId: "user_owner",
      prospectId: "prospect_1",
    });
  });

  it("preserves a committed create and redirects when success logging and revalidation fail", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    createMock.mockResolvedValue({ id: "prospect_1" });
    logInfoMock.mockImplementationOnce(() => {
      throw new Error("logger internals leaked");
    });
    revalidatePathMock.mockImplementationOnce(() => {
      throw new Error("cache internals leaked");
    });
    const { createProspect } = await import("./prospects");

    await expect(createProspect({}, form(valid))).resolves.toEqual({
      status: "success",
      message: "Prospect created.",
    });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(redirectMock).toHaveBeenCalledWith(
      "/prospects/prospect_1?created=1"
    );
    expect(logErrorMock).not.toHaveBeenCalledWith(
      "prospect.create.failed",
      expect.anything()
    );
    expect(logErrorMock).toHaveBeenCalledWith("prospect.observability.failed", {
      action: "create",
      code: "LOGGING_ERROR",
      prospectId: "prospect_1",
      userId: "user_owner",
    });
    expect(logErrorMock).toHaveBeenCalledWith("prospect.revalidation.failed", {
      action: "create",
      code: "CACHE_REVALIDATION_ERROR",
      prospectId: "prospect_1",
      userId: "user_owner",
    });
  });

  it("preserves a committed update when cache revalidation fails", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    updateManyMock.mockResolvedValue({ count: 1 });
    revalidatePathMock.mockImplementationOnce(() => {
      throw new Error("cache internals leaked");
    });
    const { updateProspect } = await import("./prospects");

    await expect(
      updateProspect({}, form({ ...valid, prospectId: "prospect_1" }))
    ).resolves.toEqual({
      status: "success",
      message: "Prospect saved.",
    });
    expect(updateManyMock).toHaveBeenCalledTimes(1);
    expect(logErrorMock).not.toHaveBeenCalledWith(
      "prospect.update.failed",
      expect.anything()
    );
    expect(logErrorMock).toHaveBeenCalledWith("prospect.revalidation.failed", {
      action: "update",
      code: "CACHE_REVALIDATION_ERROR",
      prospectId: "prospect_1",
      userId: "user_owner",
    });
  });

  it.each([
    ["archive", "Prospect archived."],
    ["restore", "Prospect restored."],
  ] as const)("preserves a committed %s when success logging fails", async (action, message) => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    updateManyMock.mockResolvedValue({ count: 1 });
    logInfoMock.mockImplementationOnce(() => {
      throw new Error("logger internals leaked");
    });
    const actions = await import("./prospects");

    const result =
      action === "archive"
        ? await actions.archiveProspect("prospect_1")
        : await actions.restoreProspect("prospect_1");

    expect(result).toEqual({ status: "success", message });
    expect(updateManyMock).toHaveBeenCalledTimes(1);
    expect(logErrorMock).not.toHaveBeenCalledWith(
      "prospect.archive_state.failed",
      expect.anything()
    );
    expect(logErrorMock).toHaveBeenCalledWith("prospect.observability.failed", {
      action,
      code: "LOGGING_ERROR",
      prospectId: "prospect_1",
      userId: "user_owner",
    });
  });
});

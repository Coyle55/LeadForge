import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const prospectFindFirstMock = vi.fn();
const taskCreateMock = vi.fn();
const taskFindFirstMock = vi.fn();
const taskUpdateManyMock = vi.fn();
const logInfoMock = vi.fn();
const logErrorMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@repo/auth/server", () => ({ auth: authMock }));
vi.mock("@repo/auth", () => ({
  isAllowedUserId: (userId: string) => userId === "user_owner",
}));
vi.mock("@repo/database", () => ({
  database: {
    prospect: { findFirst: prospectFindFirstMock },
    task: {
      create: taskCreateMock,
      findFirst: taskFindFirstMock,
      updateMany: taskUpdateManyMock,
    },
  },
}));
vi.mock("@repo/observability", () => ({
  logger: { info: logInfoMock, error: logErrorMock },
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    data.set(key, value);
  }
  return data;
};

const valid = {
  title: "  Follow up with Acme  ",
  dueAt: "2026-08-04T09:30:00-04:00",
  priority: "HIGH",
};

const databaseCallCount = () =>
  [
    prospectFindFirstMock,
    taskCreateMock,
    taskFindFirstMock,
    taskUpdateManyMock,
  ].reduce((total, mock) => total + mock.mock.calls.length, 0);

const revalidatedPaths = () =>
  revalidatePathMock.mock.calls.map(([path]) => path);

describe("task actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ALLOWED_USER_IDS = "user_owner";
  });

  it("exits before database access for signed-out and disallowed callers", async () => {
    const { completeTask, createTask, reopenTask, updateTask } = await import(
      "./tasks"
    );

    authMock.mockResolvedValueOnce({ userId: null });
    await expect(createTask("prospect_1", {}, form(valid))).resolves.toEqual({
      status: "error",
      message: "Not authorized.",
    });

    authMock.mockResolvedValueOnce({ userId: "user_other" });
    await expect(updateTask("task_1", {}, form(valid))).resolves.toEqual({
      status: "error",
      message: "Not authorized.",
    });

    authMock.mockResolvedValueOnce({ userId: null });
    await expect(completeTask("task_1")).resolves.toEqual({
      status: "error",
      message: "Not authorized.",
    });

    authMock.mockResolvedValueOnce({ userId: "user_other" });
    await expect(reopenTask("task_1")).resolves.toEqual({
      status: "error",
      message: "Not authorized.",
    });

    expect(databaseCallCount()).toBe(0);
  });

  it("reloads the owned active prospect and creates from trusted fields only", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    prospectFindFirstMock.mockResolvedValue({ id: "prospect_1" });
    taskCreateMock.mockResolvedValue({ id: "task_1" });
    const { createTask } = await import("./tasks");

    await expect(
      createTask(
        "prospect_1",
        {},
        form({
          ...valid,
          userId: "user_victim",
          prospectId: "prospect_victim",
          status: "COMPLETED",
          completedAt: "2026-01-01T00:00:00.000Z",
        })
      )
    ).resolves.toEqual({ status: "success", message: "Task created." });

    expect(prospectFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: "prospect_1",
        userId: "user_owner",
        archivedAt: null,
      },
      select: { id: true },
    });
    expect(taskCreateMock).toHaveBeenCalledWith({
      data: {
        userId: "user_owner",
        prospectId: "prospect_1",
        title: "Follow up with Acme",
        dueAt: new Date("2026-08-04T13:30:00.000Z"),
        priority: "HIGH",
      },
    });
    expect(revalidatedPaths()).toEqual([
      "/tasks",
      "/prospects/prospect_1",
      "/",
    ]);
  });

  it("rejects invalid editable fields before loading a prospect", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    const { createTask } = await import("./tasks");

    const result = await createTask(
      "prospect_1",
      {},
      form({ ...valid, title: " ", dueAt: "2026-08-04T09:30" })
    );

    expect(result).toMatchObject({
      status: "error",
      message: "Check the highlighted fields.",
      fieldErrors: {
        title: expect.any(Array),
        dueAt: expect.any(Array),
      },
    });
    expect(databaseCallCount()).toBe(0);
  });

  it("returns one safe result when the owned active prospect is absent", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    prospectFindFirstMock.mockResolvedValue(null);
    const { createTask } = await import("./tasks");

    await expect(
      createTask("prospect_missing_or_other_owner", {}, form(valid))
    ).resolves.toEqual({ status: "error", message: "Prospect not found." });
    expect(taskCreateMock).not.toHaveBeenCalled();
  });

  it("edits only title dueAt and priority through an owner-scoped update", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    taskFindFirstMock.mockResolvedValue({ prospectId: "prospect_1" });
    taskUpdateManyMock.mockResolvedValue({ count: 1 });
    const { updateTask } = await import("./tasks");

    await expect(
      updateTask(
        "task_1",
        {},
        form({
          ...valid,
          userId: "user_victim",
          prospectId: "prospect_victim",
          status: "COMPLETED",
          completedAt: "2026-01-01T00:00:00.000Z",
        })
      )
    ).resolves.toEqual({ status: "success", message: "Task saved." });

    expect(taskFindFirstMock).toHaveBeenCalledWith({
      where: { id: "task_1", userId: "user_owner" },
      select: { prospectId: true },
    });
    expect(taskUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "task_1", userId: "user_owner" },
      data: {
        title: "Follow up with Acme",
        dueAt: new Date("2026-08-04T13:30:00.000Z"),
        priority: "HIGH",
      },
    });
    expect(revalidatedPaths()).toEqual([
      "/tasks",
      "/prospects/prospect_1",
      "/",
    ]);
  });

  it("completes only an owned open task with one server timestamp", async () => {
    const startedAt = Date.now();
    authMock.mockResolvedValue({ userId: "user_owner" });
    taskFindFirstMock.mockResolvedValue({ prospectId: "prospect_1" });
    taskUpdateManyMock.mockResolvedValue({ count: 1 });
    const { completeTask } = await import("./tasks");

    await expect(completeTask("task_1")).resolves.toEqual({
      status: "success",
      message: "Task completed.",
    });
    expect(taskUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "task_1", userId: "user_owner", status: "OPEN" },
      data: { status: "COMPLETED", completedAt: expect.any(Date) },
    });
    const completedAt = taskUpdateManyMock.mock.calls[0]?.[0]?.data.completedAt;
    expect(completedAt.getTime()).toBeGreaterThanOrEqual(startedAt);
    expect(completedAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(revalidatedPaths()).toEqual([
      "/tasks",
      "/prospects/prospect_1",
      "/",
    ]);
  });

  it("reopens only an owned completed task and clears completedAt", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    taskFindFirstMock.mockResolvedValue({ prospectId: "prospect_1" });
    taskUpdateManyMock.mockResolvedValue({ count: 1 });
    const { reopenTask } = await import("./tasks");

    await expect(reopenTask("task_1")).resolves.toEqual({
      status: "success",
      message: "Task reopened.",
    });
    expect(taskUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: "task_1",
        userId: "user_owner",
        status: "COMPLETED",
      },
      data: { status: "OPEN", completedAt: null },
    });
    expect(revalidatedPaths()).toEqual([
      "/tasks",
      "/prospects/prospect_1",
      "/",
    ]);
  });

  it("uses one safe result for absent tasks and invalid state transitions", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    taskFindFirstMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      prospectId: "prospect_1",
    });
    taskUpdateManyMock.mockResolvedValue({ count: 0 });
    const { completeTask, updateTask } = await import("./tasks");

    await expect(
      updateTask("task_missing_or_other_owner", {}, form(valid))
    ).resolves.toEqual({ status: "error", message: "Task not found." });
    await expect(completeTask("task_already_completed")).resolves.toEqual({
      status: "error",
      message: "Task not found.",
    });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("logs only IDs action and a safe code when create persistence fails", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    prospectFindFirstMock.mockResolvedValue({ id: "prospect_1" });
    taskCreateMock.mockRejectedValue(new Error("database password leaked"));
    const { createTask } = await import("./tasks");

    await expect(
      createTask(
        "prospect_1",
        {},
        form({ ...valid, title: "Sensitive customer follow-up" })
      )
    ).resolves.toEqual({
      status: "error",
      message: "Unable to save task.",
    });
    expect(logErrorMock).toHaveBeenCalledWith("task.mutation.failed", {
      action: "create",
      code: "DATABASE_ERROR",
      prospectId: "prospect_1",
      userId: "user_owner",
    });
    expect(JSON.stringify(logErrorMock.mock.calls)).not.toContain("Sensitive");
    expect(JSON.stringify(logErrorMock.mock.calls)).not.toContain("password");
  });

  it("keeps a committed create successful when cache revalidation fails", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    prospectFindFirstMock.mockResolvedValue({ id: "prospect_1" });
    taskCreateMock.mockResolvedValue({ id: "task_1" });
    revalidatePathMock.mockImplementationOnce(() => {
      throw new Error("cache internals leaked");
    });
    const { createTask } = await import("./tasks");

    await expect(createTask("prospect_1", {}, form(valid))).resolves.toEqual({
      status: "success",
      message: "Task created.",
    });
    expect(taskCreateMock).toHaveBeenCalledTimes(1);
    expect(revalidatedPaths()).toEqual([
      "/tasks",
      "/prospects/prospect_1",
      "/",
    ]);
    expect(logErrorMock).toHaveBeenCalledWith("task.revalidation.failed", {
      action: "create",
      code: "CACHE_REVALIDATION_ERROR",
      prospectId: "prospect_1",
      taskId: "task_1",
      userId: "user_owner",
    });
    expect(JSON.stringify(logErrorMock.mock.calls)).not.toContain("internals");
  });

  it("keeps a committed update successful when success logging fails", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    taskFindFirstMock.mockResolvedValue({ prospectId: "prospect_1" });
    taskUpdateManyMock.mockResolvedValue({ count: 1 });
    logInfoMock.mockImplementationOnce(() => {
      throw new Error("logger internals leaked");
    });
    const { updateTask } = await import("./tasks");

    await expect(updateTask("task_1", {}, form(valid))).resolves.toEqual({
      status: "success",
      message: "Task saved.",
    });
    expect(taskUpdateManyMock).toHaveBeenCalledTimes(1);
    expect(logErrorMock).toHaveBeenCalledWith("task.observability.failed", {
      action: "update",
      code: "LOGGING_ERROR",
      taskId: "task_1",
      userId: "user_owner",
    });
    expect(JSON.stringify(logErrorMock.mock.calls)).not.toContain("internals");
  });

  it.each([
    ["update", "save"],
    ["complete", "update"],
    ["reopen", "update"],
  ] as const)("logs sanitized metadata when %s persistence fails", async (action, messageVerb) => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    taskFindFirstMock.mockResolvedValue({ prospectId: "prospect_1" });
    taskUpdateManyMock.mockRejectedValue(
      new Error("database password leaked for Sensitive customer follow-up")
    );
    const actions = await import("./tasks");

    let result: Awaited<ReturnType<typeof actions.updateTask>>;
    if (action === "update") {
      result = await actions.updateTask("task_1", {}, form(valid));
    } else if (action === "complete") {
      result = await actions.completeTask("task_1");
    } else {
      result = await actions.reopenTask("task_1");
    }

    expect(result).toEqual({
      status: "error",
      message: `Unable to ${messageVerb} task.`,
    });
    expect(logErrorMock).toHaveBeenCalledWith("task.mutation.failed", {
      action,
      code: "DATABASE_ERROR",
      taskId: "task_1",
      userId: "user_owner",
    });
    expect(JSON.stringify(logErrorMock.mock.calls)).not.toContain("Sensitive");
    expect(JSON.stringify(logErrorMock.mock.calls)).not.toContain("password");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const taskFindManyMock = vi.fn();
const taskCountMock = vi.fn();
const prospectFindManyMock = vi.fn();

vi.mock("@repo/database", () => ({
  database: {
    task: { count: taskCountMock, findMany: taskFindManyMock },
    prospect: { findMany: prospectFindManyMock },
  },
}));

const now = new Date("2026-08-04T16:30:00.000Z");
const todayStart = new Date("2026-08-04T04:00:00.000Z");
const tomorrowStart = new Date("2026-08-05T04:00:00.000Z");

describe("task queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskFindManyMock.mockResolvedValue([]);
    taskCountMock.mockResolvedValue(0);
    prospectFindManyMock.mockResolvedValue([]);
  });

  it("normalizes task list filters to safe defaults", async () => {
    const { parseTaskListParams } = await import("./queries");

    expect(parseTaskListParams({})).toEqual({
      page: 1,
      priority: "ALL",
      status: "OPEN",
    });
    expect(
      parseTaskListParams({
        page: ["2", "4"],
        priority: ["high", "low"],
        status: ["overdue", "completed"],
      })
    ).toEqual({ page: 2, priority: "HIGH", status: "OVERDUE" });
    expect(
      parseTaskListParams({ page: "-1", priority: "urgent", status: "done" })
    ).toEqual({ page: 1, priority: "ALL", status: "OPEN" });
  });

  it("lists due-today tasks with an owner-scoped local-day predicate", async () => {
    const { getTasks } = await import("./queries");

    await getTasks({
      now,
      page: 1,
      priority: "ALL",
      status: "DUE_TODAY",
      userId: "user_owner",
    });

    expect(taskFindManyMock).toHaveBeenCalledWith({
      orderBy: [
        { dueAt: "asc" },
        { priority: "asc" },
        { createdAt: "asc" },
        { id: "asc" },
      ],
      skip: 0,
      take: 25,
      where: {
        dueAt: { gte: todayStart, lt: tomorrowStart },
        status: "OPEN",
        userId: "user_owner",
      },
    });
    expect(taskCountMock).toHaveBeenCalledWith({
      where: {
        dueAt: { gte: todayStart, lt: tomorrowStart },
        status: "OPEN",
        userId: "user_owner",
      },
    });
  });

  it("uses the owner-scoped overdue and completed predicates", async () => {
    const { getTasks } = await import("./queries");

    await getTasks({
      now,
      page: 1,
      priority: "ALL",
      status: "OVERDUE",
      userId: "user_owner",
    });
    await getTasks({
      now,
      page: 1,
      priority: "ALL",
      status: "COMPLETED",
      userId: "user_owner",
    });

    expect(taskFindManyMock).toHaveBeenNthCalledWith(1, {
      orderBy: [
        { dueAt: "asc" },
        { priority: "asc" },
        { createdAt: "asc" },
        { id: "asc" },
      ],
      skip: 0,
      take: 25,
      where: {
        dueAt: { lt: now },
        status: "OPEN",
        userId: "user_owner",
      },
    });
    expect(taskFindManyMock).toHaveBeenNthCalledWith(2, {
      orderBy: [{ completedAt: "desc" }, { id: "asc" }],
      skip: 0,
      take: 25,
      where: { status: "COMPLETED", userId: "user_owner" },
    });
  });

  it("combines the requested priority with owner-scoped open filters", async () => {
    const { getTasks } = await import("./queries");

    await getTasks({
      now,
      page: 1,
      priority: "HIGH",
      status: "OPEN",
      userId: "user_owner",
    });

    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { priority: "HIGH", status: "OPEN", userId: "user_owner" },
      })
    );
    expect(taskCountMock).toHaveBeenCalledWith({
      where: { priority: "HIGH", status: "OPEN", userId: "user_owner" },
    });
  });

  it("orders equal-due open tasks by enum priority before pagination", async () => {
    taskFindManyMock.mockResolvedValue([
      {
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        dueAt: new Date("2026-08-05T15:00:00.000Z"),
        id: "task_high",
        priority: "HIGH",
        prospectId: "prospect_1",
      },
      {
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        dueAt: new Date("2026-08-05T15:00:00.000Z"),
        id: "task_medium",
        priority: "MEDIUM",
        prospectId: "prospect_1",
      },
    ]);
    prospectFindManyMock.mockResolvedValue([
      { businessName: "Acme", id: "prospect_1" },
    ]);
    const { getTasks } = await import("./queries");

    const result = await getTasks({
      now,
      page: 2,
      priority: "ALL",
      status: "OPEN",
      userId: "user_owner",
    });

    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [
          { dueAt: "asc" },
          { priority: "asc" },
          { createdAt: "asc" },
          { id: "asc" },
        ],
        skip: 25,
        take: 25,
      })
    );
    expect(result.tasks.map((task) => task.id)).toEqual([
      "task_high",
      "task_medium",
    ]);
  });

  it("batches prospect names with owner scope", async () => {
    taskFindManyMock.mockResolvedValue([
      { id: "task_1", prospectId: "prospect_1" },
      { id: "task_2", prospectId: "prospect_2" },
    ]);
    prospectFindManyMock.mockResolvedValue([
      {
        archivedAt: new Date("2026-08-04T12:00:00.000Z"),
        businessName: "Acme",
        id: "prospect_1",
      },
    ]);
    const { getTasks } = await import("./queries");

    await expect(
      getTasks({
        now,
        page: 1,
        priority: "ALL",
        status: "OPEN",
        userId: "user_owner",
      })
    ).resolves.toMatchObject({
      pageCount: 0,
      tasks: [
        { id: "task_1", prospectArchived: true, prospectName: "Acme" },
        {
          id: "task_2",
          prospectArchived: true,
          prospectName: "Unknown prospect",
        },
      ],
      total: 0,
    });
    expect(prospectFindManyMock).toHaveBeenCalledWith({
      select: { archivedAt: true, businessName: true, id: true },
      where: {
        id: { in: ["prospect_1", "prospect_2"] },
        userId: "user_owner",
      },
    });
  });

  it("loads a prospect's open and completed tasks without dropping owner scope", async () => {
    taskFindManyMock
      .mockResolvedValueOnce([{ id: "task_open" }])
      .mockResolvedValueOnce([{ id: "task_completed" }]);
    const { getProspectTasks } = await import("./queries");

    await expect(getProspectTasks("user_owner", "prospect_1")).resolves.toEqual(
      {
        completedTasks: [{ id: "task_completed" }],
        openTasks: [{ id: "task_open" }],
      }
    );
    expect(taskFindManyMock).toHaveBeenNthCalledWith(1, {
      orderBy: [
        { dueAt: "asc" },
        { priority: "asc" },
        { createdAt: "asc" },
        { id: "asc" },
      ],
      where: { prospectId: "prospect_1", status: "OPEN", userId: "user_owner" },
    });
    expect(taskFindManyMock).toHaveBeenNthCalledWith(2, {
      orderBy: [{ completedAt: "desc" }, { id: "asc" }],
      where: {
        prospectId: "prospect_1",
        status: "COMPLETED",
        userId: "user_owner",
      },
    });
  });
});

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, getTasksMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  getTasksMock: vi.fn(),
}));

vi.mock("@repo/auth/server", () => ({ auth: authMock }));
vi.mock("../../actions/tasks", () => ({
  completeTask: vi.fn(),
  reopenTask: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("./queries", () => ({
  getTasks: getTasksMock,
  parseTaskListParams: () => ({
    page: 1,
    priority: "ALL",
    status: "OPEN",
  }),
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ userId: "user_owner" });
});

describe("TasksPage", () => {
  it("suppresses global status controls for tasks on archived prospects", async () => {
    getTasksMock.mockResolvedValue({
      pageCount: 1,
      tasks: [
        {
          completedAt: null,
          createdAt: new Date("2026-08-01T12:00:00.000Z"),
          dueAt: new Date("2026-08-05T13:30:00.000Z"),
          id: "task_1",
          priority: "HIGH",
          prospectArchived: true,
          prospectId: "prospect_1",
          prospectName: "Acme Plumbing",
          status: "OPEN",
          title: "Call the buyer",
          updatedAt: new Date("2026-08-01T12:00:00.000Z"),
          userId: "user_owner",
        },
      ],
      total: 1,
    });
    const { default: TasksPage } = await import("./page");

    render(await TasksPage({ searchParams: Promise.resolve({}) }));

    expect(
      screen.queryByRole("button", {
        name: "Complete task: Call the buyer",
      })
    ).toBeNull();
    expect(
      screen.getByText("Archived prospect — restore it to update tasks.")
    ).toBeTruthy();
  });
});

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("../../../actions/tasks", () => ({
  completeTask: vi.fn(),
  createTask: vi.fn(),
  reopenTask: vi.fn(),
  updateTask: vi.fn(),
}));

afterEach(cleanup);

describe("TaskList", () => {
  it("identifies repeated status and edit controls by task title", async () => {
    const { TaskList } = await import("./task-list");

    render(
      <TaskList
        archived={false}
        completedTasks={[]}
        openTasks={[
          {
            completedAt: null,
            createdAt: new Date("2026-08-01T12:00:00.000Z"),
            dueAt: new Date("2026-08-05T13:30:00.000Z"),
            id: "task_1",
            priority: "HIGH",
            prospectId: "prospect_1",
            status: "OPEN",
            title: "Call the buyer",
            updatedAt: new Date("2026-08-01T12:00:00.000Z"),
            userId: "user_owner",
          },
        ]}
      />
    );

    expect(
      screen.getByRole("button", { name: "Complete task: Call the buyer" })
    ).toBeTruthy();
    expect(screen.getByLabelText("Edit task: Call the buyer")).toBeTruthy();
  });
});

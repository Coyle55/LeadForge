import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

const createTaskMock = vi.fn();

vi.mock("../../../actions/tasks", () => ({
  createTask: createTaskMock,
}));

beforeEach(() => {
  createTaskMock.mockReset();
});

describe("FollowUpSuggestion", () => {
  it("never calls the task-creation action on render, only on explicit click", async () => {
    createTaskMock.mockResolvedValue({
      status: "success",
      message: "Task created.",
    });
    const { FollowUpSuggestion } = await import("./follow-up-suggestion");

    render(<FollowUpSuggestion businessName="Acme" prospectId="prospect_1" />);

    expect(
      screen.getByRole("button", { name: "Create follow-up task" })
    ).toBeTruthy();
    expect(createTaskMock).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Create follow-up task" })
    );

    await waitFor(() => expect(createTaskMock).toHaveBeenCalledTimes(1));
  });

  it("submits a pre-filled follow-up title bound to the prospect, with a due date and priority", async () => {
    createTaskMock.mockResolvedValue({
      status: "success",
      message: "Task created.",
    });
    const { FollowUpSuggestion } = await import("./follow-up-suggestion");

    render(
      <FollowUpSuggestion
        businessName="Acme Plumbing"
        prospectId="prospect_1"
      />
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Create follow-up task" })
    );

    await waitFor(() => expect(createTaskMock).toHaveBeenCalledTimes(1));
    const [prospectId, , formData] = createTaskMock.mock.calls[0] as [
      string,
      unknown,
      FormData,
    ];
    expect(prospectId).toBe("prospect_1");
    expect(formData.get("title")).toBe("Follow up: Acme Plumbing");
    expect(formData.get("priority")).toBe("MEDIUM");
    const dueAt = formData.get("dueAt");
    expect(typeof dueAt).toBe("string");
    expect(Number.isNaN(new Date(dueAt as string).getTime())).toBe(false);
  });

  it("shows a confirmation and hides the button once the task is created", async () => {
    createTaskMock.mockResolvedValue({
      status: "success",
      message: "Task created.",
    });
    const { FollowUpSuggestion } = await import("./follow-up-suggestion");

    render(<FollowUpSuggestion businessName="Acme" prospectId="prospect_1" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Create follow-up task" })
    );

    await waitFor(() =>
      expect(screen.getByText("Follow-up task created.")).toBeTruthy()
    );
    expect(
      screen.queryByRole("button", { name: "Create follow-up task" })
    ).toBeNull();
  });
});

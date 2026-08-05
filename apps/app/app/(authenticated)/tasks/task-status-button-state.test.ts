import { describe, expect, it } from "vitest";
import {
  getTaskStatusControl,
  getTaskStatusFeedback,
} from "./task-status-button-state";

describe("task status button state", () => {
  it("describes truthful completion pending feedback", () => {
    expect(getTaskStatusControl("OPEN", false)).toEqual({
      action: "complete",
      label: "Complete",
      pendingAnnouncement: "",
    });
    expect(getTaskStatusControl("OPEN", true)).toEqual({
      action: "complete",
      label: "Completing…",
      pendingAnnouncement: "Completing task.",
    });
  });

  it("describes truthful reopen pending feedback", () => {
    expect(getTaskStatusControl("COMPLETED", false)).toEqual({
      action: "reopen",
      label: "Reopen",
      pendingAnnouncement: "",
    });
    expect(getTaskStatusControl("COMPLETED", true)).toEqual({
      action: "reopen",
      label: "Reopening…",
      pendingAnnouncement: "Reopening task.",
    });
  });

  it("maps committed results to accessible status and alert semantics", () => {
    expect(
      getTaskStatusFeedback({ message: "Task completed.", status: "success" })
    ).toEqual({ message: "Task completed.", role: "status" });
    expect(
      getTaskStatusFeedback({
        message: "Unable to update task.",
        status: "error",
      })
    ).toEqual({ message: "Unable to update task.", role: "alert" });
  });
});

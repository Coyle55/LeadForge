type TaskStatus = "COMPLETED" | "OPEN";

export interface TaskStatusControl {
  action: "complete" | "reopen";
  label: string;
  pendingAnnouncement: string;
}

export interface TaskStatusResult {
  message: string;
  status: "error" | "success";
}

export const getTaskStatusControl = (
  status: TaskStatus,
  pending: boolean
): TaskStatusControl => {
  const completing = status === "OPEN";
  if (completing) {
    return {
      action: "complete",
      label: pending ? "Completing…" : "Complete",
      pendingAnnouncement: pending ? "Completing task." : "",
    };
  }

  return {
    action: "reopen",
    label: pending ? "Reopening…" : "Reopen",
    pendingAnnouncement: pending ? "Reopening task." : "",
  };
};

export const getTaskStatusFeedback = (result: TaskStatusResult) => ({
  message: result.message,
  role: result.status === "error" ? ("alert" as const) : ("status" as const),
});

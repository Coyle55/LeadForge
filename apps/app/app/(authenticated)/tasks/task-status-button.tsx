"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  completeTask,
  reopenTask,
  type TaskActionResult,
} from "../../actions/tasks";
import {
  getTaskStatusControl,
  getTaskStatusFeedback,
} from "./task-status-button-state";

export const TaskStatusButton = ({
  status,
  taskId,
  taskTitle,
}: {
  status: "COMPLETED" | "OPEN";
  taskId: string;
  taskTitle: string;
}) => {
  const router = useRouter();
  const [result, setResult] = useState<TaskActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const control = getTaskStatusControl(status, pending);
  const feedback = result ? getTaskStatusFeedback(result) : null;

  const run = () => {
    setResult(null);
    startTransition(async () => {
      const actionResult =
        control.action === "complete"
          ? await completeTask(taskId)
          : await reopenTask(taskId);
      setResult(actionResult);
      if (actionResult.status === "success") {
        router.refresh();
      }
    });
  };

  return (
    <div aria-busy={pending} className="flex flex-col items-start gap-1.5">
      <Button
        aria-label={`${control.label} task: ${taskTitle}`}
        disabled={pending}
        onClick={run}
        size="sm"
        type="button"
        variant={status === "OPEN" ? "default" : "outline"}
      >
        {control.label}
      </Button>
      <span aria-live="polite" className="sr-only">
        {control.pendingAnnouncement}
      </span>
      {feedback && !pending ? (
        <p
          className={
            feedback.role === "alert"
              ? "max-w-40 text-destructive text-xs"
              : "max-w-40 text-emerald-700 text-xs dark:text-emerald-400"
          }
          role={feedback.role}
        >
          {feedback.message}
        </p>
      ) : null}
    </div>
  );
};

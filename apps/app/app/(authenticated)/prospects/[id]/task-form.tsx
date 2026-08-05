"use client";

import type { TaskPriority } from "@repo/database";
import { Button } from "@repo/design-system/components/ui/button";
import { Input } from "@repo/design-system/components/ui/input";
import { Label } from "@repo/design-system/components/ui/label";
import { useActionState, useCallback, useRef, useState } from "react";
import {
  createTask,
  type TaskFormState,
  updateTask,
} from "../../../actions/tasks";
import { dateToZonedLocalInput } from "../../../lib/tasks/time";
import { prepareTaskFormData } from "./task-form-state";

interface InitialTaskFields {
  dueAt: Date | null;
  priority: TaskPriority;
  title: string;
}

interface RevisionAwareTaskFormState extends TaskFormState {
  submissionRevision?: number;
}

const FieldError = ({ errors, id }: { errors?: string[]; id: string }) =>
  errors?.[0] ? (
    <p className="text-destructive text-xs" id={id}>
      {errors[0]}
    </p>
  ) : null;

export const TaskForm = ({
  initial,
  mode,
  prospectId,
  taskId,
}: {
  initial: InitialTaskFields;
  mode: "create" | "edit";
  prospectId?: string;
  taskId?: string;
}) => {
  const revisionRef = useRef(0);
  const [revision, setRevision] = useState(0);
  const submit = useCallback(
    async (
      previousState: RevisionAwareTaskFormState,
      formData: FormData
    ): Promise<RevisionAwareTaskFormState> => {
      const submissionRevision = revisionRef.current;
      let prepared: FormData;
      try {
        prepared = prepareTaskFormData(formData);
      } catch {
        return {
          fieldErrors: {
            dueAt: [
              "That time does not exist in New York. Choose another time.",
            ],
          },
          message: "Check the highlighted fields.",
          status: "error",
          submissionRevision,
        };
      }

      const result =
        mode === "create"
          ? await createTask(prospectId ?? "", previousState, prepared)
          : await updateTask(taskId ?? "", previousState, prepared);
      return { ...result, submissionRevision };
    },
    [mode, prospectId, taskId]
  );
  const [state, action, pending] = useActionState<
    RevisionAwareTaskFormState,
    FormData
  >(submit, {});
  const feedbackIsCurrent = !pending && state.submissionRevision === revision;
  const feedbackState: TaskFormState = feedbackIsCurrent ? state : {};
  const idPrefix = `task-${taskId ?? prospectId ?? "new"}-${mode}`;
  const titleErrorId = `${idPrefix}-title-error`;
  const dueAtErrorId = `${idPrefix}-due-at-error`;
  const priorityErrorId = `${idPrefix}-priority-error`;
  let submitLabel = mode === "create" ? "Create task" : "Save task";
  let pendingAnnouncement = "";
  if (pending) {
    submitLabel = mode === "create" ? "Creating…" : "Saving…";
    pendingAnnouncement = mode === "create" ? "Creating task." : "Saving task.";
  }

  const markChanged = () => {
    revisionRef.current += 1;
    setRevision(revisionRef.current);
  };

  return (
    <form
      action={action}
      aria-busy={pending}
      className="space-y-4"
      onChange={markChanged}
    >
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-title`}>Task title</Label>
        <Input
          aria-describedby={
            feedbackState.fieldErrors?.title ? titleErrorId : undefined
          }
          aria-invalid={Boolean(feedbackState.fieldErrors?.title)}
          defaultValue={initial.title}
          disabled={pending}
          id={`${idPrefix}-title`}
          maxLength={160}
          name="title"
          required
        />
        <FieldError
          errors={feedbackState.fieldErrors?.title}
          id={titleErrorId}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-due-at`}>Due date and time</Label>
          <Input
            aria-describedby={
              feedbackState.fieldErrors?.dueAt ? dueAtErrorId : undefined
            }
            aria-invalid={Boolean(feedbackState.fieldErrors?.dueAt)}
            defaultValue={
              initial.dueAt ? dateToZonedLocalInput(initial.dueAt) : ""
            }
            disabled={pending}
            id={`${idPrefix}-due-at`}
            name="dueAtLocal"
            required
            type="datetime-local"
          />
          <p className="text-[11px] text-muted-foreground">New York time</p>
          <FieldError
            errors={feedbackState.fieldErrors?.dueAt}
            id={dueAtErrorId}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-priority`}>Priority</Label>
          <select
            aria-describedby={
              feedbackState.fieldErrors?.priority ? priorityErrorId : undefined
            }
            aria-invalid={Boolean(feedbackState.fieldErrors?.priority)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
            defaultValue={initial.priority}
            disabled={pending}
            id={`${idPrefix}-priority`}
            name="priority"
          >
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
          <FieldError
            errors={feedbackState.fieldErrors?.priority}
            id={priorityErrorId}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending} size="sm" type="submit">
          {submitLabel}
        </Button>
        <span aria-live="polite" className="sr-only">
          {pendingAnnouncement}
        </span>
        {feedbackState.message ? (
          <p
            className={
              feedbackState.status === "error"
                ? "text-destructive text-sm"
                : "text-emerald-700 text-sm dark:text-emerald-400"
            }
            role={feedbackState.status === "error" ? "alert" : "status"}
          >
            {feedbackState.message}
          </p>
        ) : null}
      </div>
    </form>
  );
};

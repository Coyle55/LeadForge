"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { useActionState } from "react";
import { createTask, type TaskFormState } from "../../../actions/tasks";
import { addBusinessDays } from "../../../lib/tasks/time";

const FOLLOW_UP_BUSINESS_DAYS = 5;

export const FollowUpSuggestion = ({
  businessName,
  prospectId,
}: {
  businessName: string;
  prospectId: string;
}) => {
  const [state, action, pending] = useActionState<TaskFormState, FormData>(
    createTask.bind(null, prospectId),
    {}
  );

  if (state.status === "success") {
    return (
      <output className="text-emerald-700 text-sm">
        Follow-up task created.
      </output>
    );
  }

  const dueAt = addBusinessDays(new Date(), FOLLOW_UP_BUSINESS_DAYS);

  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input name="title" type="hidden" value={`Follow up: ${businessName}`} />
      <input name="dueAt" type="hidden" value={dueAt.toISOString()} />
      <input name="priority" type="hidden" value="MEDIUM" />
      <Button disabled={pending} size="sm" type="submit">
        {pending ? "Creating…" : "Create follow-up task"}
      </Button>
      {state.status === "error" && state.message ? (
        <p className="text-destructive text-sm" role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
};

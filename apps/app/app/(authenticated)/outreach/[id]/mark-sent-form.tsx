"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { useActionState } from "react";
import {
  markOutreachSent,
  type OutreachSentResult,
} from "../../../actions/outreach";
import { FollowUpSuggestion } from "./follow-up-suggestion";

export const MarkSentForm = ({
  businessName,
  draftId,
  prospectId,
  sentAt,
  sentBody,
  sentSubject,
  status,
}: {
  businessName: string;
  draftId: string;
  prospectId: string;
  sentAt: Date | null;
  sentBody: string | null;
  sentSubject: string | null;
  status: "COMPLETED" | "SENT";
}) => {
  const [state, action, pending] = useActionState<OutreachSentResult, FormData>(
    async () => await markOutreachSent(draftId),
    {} as OutreachSentResult
  );

  // The follow-up suggestion is only ever offered right after a successful
  // submission in this client session — a fresh mount of an already-SENT
  // draft (e.g. after a page reload) never shows it, and there is no path
  // that creates a task without the owner explicitly clicking its button.
  const justSent = state.status === "success";

  return (
    <div className="space-y-3 border-t pt-5">
      {status === "SENT" ? (
        <>
          <p className="font-medium text-emerald-600 text-xs uppercase tracking-[0.18em]">
            Sent
          </p>
          {sentAt ? (
            <time
              className="text-muted-foreground text-sm"
              dateTime={sentAt.toISOString()}
            >
              Sent {sentAt.toLocaleString()}
            </time>
          ) : null}
          <div className="space-y-1 rounded-md border bg-muted/30 p-3">
            <p className="font-medium text-sm">{sentSubject}</p>
            <p className="whitespace-pre-wrap text-muted-foreground text-sm">
              {sentBody}
            </p>
          </div>
        </>
      ) : (
        <form action={action} className="flex flex-wrap items-center gap-3">
          <Button disabled={pending || justSent} type="submit">
            {pending ? "Marking sent…" : "Mark as sent"}
          </Button>
          {state.message ? (
            <p
              className={
                state.status === "error"
                  ? "text-destructive text-sm"
                  : "text-emerald-700 text-sm"
              }
              role={state.status === "error" ? "alert" : "status"}
            >
              {state.message}
            </p>
          ) : null}
        </form>
      )}
      {justSent ? (
        <FollowUpSuggestion
          businessName={businessName}
          prospectId={prospectId}
        />
      ) : null}
    </div>
  );
};

"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { Input } from "@repo/design-system/components/ui/input";
import { Label } from "@repo/design-system/components/ui/label";
import { Textarea } from "@repo/design-system/components/ui/textarea";
import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import {
  type OutreachDraftState,
  resetOutreachDraft,
  updateOutreachDraft,
} from "../../../actions/outreach-drafts";

type CopyState = "idle" | "copied" | "failed";

const CopyButton = ({ label, value }: { label: string; value: string }) => {
  const [state, setState] = useState<CopyState>("idle");
  let text = label;
  if (state === "copied") {
    text = "Copied";
  } else if (state === "failed") {
    text = "Copy failed";
  }

  return (
    <Button
      aria-live="polite"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setState("copied");
        } catch {
          setState("failed");
        }
        window.setTimeout(() => setState("idle"), 2000);
      }}
      size="sm"
      type="button"
      variant="outline"
    >
      {text}
    </Button>
  );
};

export const DraftEditor = ({
  body: initialBody,
  draftId,
  generatedBody,
  generatedSubject,
  subject: initialSubject,
}: {
  body: string;
  draftId: string;
  generatedBody: string;
  generatedSubject: string;
  subject: string;
}) => {
  const router = useRouter();
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [saveState, saveAction, savePending] = useActionState<
    OutreachDraftState,
    FormData
  >(updateOutreachDraft, {});
  const [resetState, setResetState] = useState<OutreachDraftState>({});
  const [resetPending, startResetTransition] = useTransition();
  const feedback = resetState.message ? resetState : saveState;

  return (
    <form
      action={saveAction}
      className="space-y-6"
      onSubmit={() => setResetState({})}
    >
      <input name="draftId" type="hidden" value={draftId} />
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="outreach-subject">Subject</Label>
          <CopyButton label="Copy subject" value={subject} />
        </div>
        <Input
          id="outreach-subject"
          maxLength={120}
          minLength={3}
          name="subject"
          onChange={(event) => setSubject(event.target.value)}
          required
          value={subject}
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="outreach-body">Plain-text message</Label>
          <CopyButton label="Copy body" value={body} />
        </div>
        <Textarea
          className="min-h-80 resize-y font-mono leading-6"
          id="outreach-body"
          maxLength={2000}
          minLength={40}
          name="body"
          onChange={(event) => setBody(event.target.value)}
          required
          value={body}
        />
        <p className="text-muted-foreground text-xs">
          Plain text only · {body.length.toLocaleString()} / 2,000 characters
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t pt-5">
        <Button disabled={savePending || resetPending} type="submit">
          {savePending ? "Saving…" : "Save"}
        </Button>
        <Button
          disabled={savePending || resetPending}
          onClick={() =>
            startResetTransition(async () => {
              setResetState({});
              const result = await resetOutreachDraft(draftId);
              setResetState(result);
              if (result.status === "success") {
                setSubject(generatedSubject);
                setBody(generatedBody);
                router.refresh();
              }
            })
          }
          type="button"
          variant="outline"
        >
          {resetPending ? "Resetting…" : "Reset"}
        </Button>
        {feedback.message ? (
          <output
            className={
              feedback.status === "error"
                ? "text-destructive text-sm"
                : "text-emerald-700 text-sm"
            }
          >
            {feedback.message}
          </output>
        ) : null}
      </div>
    </form>
  );
};

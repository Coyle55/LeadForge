"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { Input } from "@repo/design-system/components/ui/input";
import { Label } from "@repo/design-system/components/ui/label";
import { Textarea } from "@repo/design-system/components/ui/textarea";
import { useRouter } from "next/navigation";
import {
  useActionState,
  useCallback,
  useReducer,
  useState,
  useTransition,
} from "react";
import {
  type OutreachDraftState,
  resetOutreachDraft,
  updateOutreachDraft,
} from "../../../actions/outreach-drafts";
import {
  createDraftEditorState,
  draftEditorReducer,
  isDraftEditorDirty,
} from "./draft-editor-state";

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
  const [editor, dispatch] = useReducer(
    draftEditorReducer,
    { body: initialBody, subject: initialSubject },
    createDraftEditorState
  );
  const saveDraft = useCallback(
    async (previousState: OutreachDraftState, formData: FormData) => {
      const submitted = {
        body: String(formData.get("body") ?? ""),
        subject: String(formData.get("subject") ?? ""),
      };
      const result = await updateOutreachDraft(previousState, formData);
      dispatch({ type: "saveResult", result, submitted });
      return result;
    },
    []
  );
  const [, saveAction, savePending] = useActionState<
    OutreachDraftState,
    FormData
  >(saveDraft, {});
  const [resetPending, startResetTransition] = useTransition();
  const dirty = isDraftEditorDirty(editor);
  const feedbackMessage =
    editor.feedback?.message ?? (dirty ? "Unsaved changes." : undefined);
  const feedbackStatus = editor.feedback?.status ?? (dirty ? "dirty" : null);
  let feedbackClassName = "text-muted-foreground text-sm";
  if (feedbackStatus === "error") {
    feedbackClassName = "text-destructive text-sm";
  } else if (feedbackStatus === "success") {
    feedbackClassName = "text-emerald-700 text-sm";
  }

  return (
    <form
      action={saveAction}
      className="space-y-6"
      onSubmit={() => dispatch({ type: "clearFeedback" })}
    >
      <input name="draftId" type="hidden" value={draftId} />
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="outreach-subject">Subject</Label>
          <CopyButton label="Copy subject" value={editor.current.subject} />
        </div>
        <Input
          id="outreach-subject"
          maxLength={120}
          minLength={3}
          name="subject"
          onChange={(event) =>
            dispatch({
              type: "edit",
              field: "subject",
              value: event.target.value,
            })
          }
          required
          value={editor.current.subject}
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="outreach-body">Plain-text message</Label>
          <CopyButton label="Copy body" value={editor.current.body} />
        </div>
        <Textarea
          className="min-h-80 resize-y font-mono leading-6"
          id="outreach-body"
          maxLength={2000}
          minLength={40}
          name="body"
          onChange={(event) =>
            dispatch({
              type: "edit",
              field: "body",
              value: event.target.value,
            })
          }
          required
          value={editor.current.body}
        />
        <p className="text-muted-foreground text-xs">
          Plain text only · {editor.current.body.length.toLocaleString()} /
          2,000 characters
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
              dispatch({ type: "clearFeedback" });
              const result = await resetOutreachDraft(draftId);
              dispatch({
                type: "resetResult",
                result,
                generated: {
                  body: generatedBody,
                  subject: generatedSubject,
                },
              });
              if (result.status === "success") {
                router.refresh();
              }
            })
          }
          type="button"
          variant="outline"
        >
          {resetPending ? "Resetting…" : "Reset"}
        </Button>
        {feedbackMessage ? (
          <output className={feedbackClassName}>{feedbackMessage}</output>
        ) : null}
      </div>
    </form>
  );
};

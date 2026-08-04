import { describe, expect, it } from "vitest";
import {
  createDraftEditorState,
  draftEditorReducer,
  isDraftEditorDirty,
} from "./draft-editor-state";

const initial = {
  subject: "Original subject",
  body: "Hi Jordan,\n\nThis is the original generated outreach body.",
};

describe("draft editor state", () => {
  it("clears saved feedback and reports unsaved changes after another edit", () => {
    let state = createDraftEditorState(initial);
    state = draftEditorReducer(state, {
      type: "edit",
      field: "subject",
      value: "Edited subject",
    });
    state = draftEditorReducer(state, {
      type: "saveResult",
      result: { status: "success", message: "Draft saved." },
      submitted: { ...initial, subject: "Edited subject" },
    });

    expect(state.feedback).toEqual({
      status: "success",
      message: "Draft saved.",
    });
    expect(isDraftEditorDirty(state)).toBe(false);

    state = draftEditorReducer(state, {
      type: "edit",
      field: "body",
      value: `${initial.body}\nOne more change.`,
    });

    expect(state.feedback).toBeUndefined();
    expect(isDraftEditorDirty(state)).toBe(true);
  });

  it("keeps edits made during save dirty against the submitted baseline", () => {
    let state = createDraftEditorState(initial);
    state = draftEditorReducer(state, {
      type: "edit",
      field: "subject",
      value: "Submitted subject",
    });
    state = draftEditorReducer(state, {
      type: "edit",
      field: "subject",
      value: "New edit while saving",
    });
    state = draftEditorReducer(state, {
      type: "saveResult",
      result: { status: "success", message: "Draft saved." },
      submitted: { ...initial, subject: "Submitted subject" },
    });

    expect(state.current.subject).toBe("New edit while saving");
    expect(state.committed.subject).toBe("Submitted subject");
    expect(state.feedback).toBeUndefined();
    expect(isDraftEditorDirty(state)).toBe(true);
  });

  it("makes a successful reset the clean committed baseline", () => {
    let state = createDraftEditorState({
      ...initial,
      subject: "Working subject",
    });
    state = draftEditorReducer(state, {
      type: "resetResult",
      result: { status: "success", message: "Draft reset." },
      generated: initial,
    });

    expect(state.current).toEqual(initial);
    expect(state.committed).toEqual(initial);
    expect(state.feedback).toEqual({
      status: "success",
      message: "Draft reset.",
    });
    expect(isDraftEditorDirty(state)).toBe(false);
  });
});

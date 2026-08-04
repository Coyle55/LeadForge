import type { OutreachDraftState } from "../../../actions/outreach-drafts";

export interface DraftEditorValues {
  body: string;
  subject: string;
}

export interface DraftEditorState {
  committed: DraftEditorValues;
  current: DraftEditorValues;
  feedback?: OutreachDraftState;
}

type DraftEditorEvent =
  | { type: "clearFeedback" }
  | {
      type: "edit";
      field: keyof DraftEditorValues;
      value: string;
    }
  | {
      type: "resetResult";
      generated: DraftEditorValues;
      result: OutreachDraftState;
    }
  | {
      type: "saveResult";
      submitted: DraftEditorValues;
      result: OutreachDraftState;
    };

const valuesMatch = (left: DraftEditorValues, right: DraftEditorValues) =>
  left.subject === right.subject && left.body === right.body;

export const createDraftEditorState = (
  values: DraftEditorValues
): DraftEditorState => ({
  committed: { ...values },
  current: { ...values },
});

export const isDraftEditorDirty = (state: DraftEditorState) =>
  !valuesMatch(state.current, state.committed);

export const draftEditorReducer = (
  state: DraftEditorState,
  event: DraftEditorEvent
): DraftEditorState => {
  if (event.type === "clearFeedback") {
    return { ...state, feedback: undefined };
  }
  if (event.type === "edit") {
    return {
      ...state,
      current: { ...state.current, [event.field]: event.value },
      feedback: undefined,
    };
  }
  if (event.type === "saveResult") {
    if (event.result.status !== "success") {
      return { ...state, feedback: event.result };
    }
    const committed = { ...event.submitted };
    return {
      ...state,
      committed,
      feedback: valuesMatch(state.current, committed)
        ? event.result
        : undefined,
    };
  }
  if (event.result.status !== "success") {
    return { ...state, feedback: event.result };
  }
  const generated = { ...event.generated };
  return {
    committed: generated,
    current: { ...generated },
    feedback: event.result,
  };
};

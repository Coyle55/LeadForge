import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ListControls } from "./list-controls";

afterEach(cleanup);

describe("ListControls", () => {
  it("associates visible labels with archive-state and pipeline-stage filters", () => {
    render(
      <ListControls page={1} search="" stage={undefined} status="ACTIVE" />
    );

    const archiveState = screen.getByLabelText("Archive state");
    const pipelineStage = screen.getByLabelText("Pipeline stage");

    expect(archiveState.hasAttribute("id")).toBe(true);
    expect(pipelineStage.hasAttribute("id")).toBe(true);
    expect(screen.getByText("Archive state").getAttribute("for")).toBe(
      archiveState.id
    );
    expect(screen.getByText("Pipeline stage").getAttribute("for")).toBe(
      pipelineStage.id
    );
  });
});

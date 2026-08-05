import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { moveProspectStageMock, saveDealMock } = vi.hoisted(() => ({
  moveProspectStageMock: vi.fn(),
  saveDealMock: vi.fn(),
}));

vi.mock("../../../actions/pipeline", () => ({
  moveProspectStage: moveProspectStageMock,
  saveDeal: saveDealMock,
}));

afterEach(cleanup);
beforeEach(() => {
  moveProspectStageMock.mockReset();
  saveDealMock.mockReset();
  moveProspectStageMock.mockResolvedValue({});
  saveDealMock.mockResolvedValue({});
});

describe("PipelineDealForm", () => {
  it("resets the pending destination when the committed stage changes", async () => {
    const { PipelineDealForm } = await import("./pipeline-deal-form");
    const { rerender } = render(
      <PipelineDealForm
        archived={false}
        deal={null}
        prospectId="prospect_1"
        stage="NEW"
      />
    );
    const destination = screen.getByLabelText("Move to") as HTMLSelectElement;
    fireEvent.change(destination, { target: { value: "CONTACTED" } });
    expect(destination.value).toBe("CONTACTED");

    rerender(
      <PipelineDealForm
        archived={false}
        deal={null}
        prospectId="prospect_1"
        stage="CONTACTED"
      />
    );

    expect((screen.getByLabelText("Move to") as HTMLSelectElement).value).toBe(
      ""
    );
    expect(screen.queryByRole("option", { name: "Contacted" })).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Move prospect" })
        .hasAttribute("disabled")
    ).toBe(true);
  });
});

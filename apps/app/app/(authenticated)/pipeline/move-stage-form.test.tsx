import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { moveProspectStageMock } = vi.hoisted(() => ({
  moveProspectStageMock: vi.fn(),
}));
vi.mock("../../actions/pipeline", () => ({
  moveProspectStage: moveProspectStageMock,
}));

afterEach(cleanup);
beforeEach(() => {
  moveProspectStageMock.mockReset();
  moveProspectStageMock.mockResolvedValue({});
});

describe("MoveStageForm", () => {
  it("reveals the required value and actual close date only for Won", async () => {
    const { MoveStageForm } = await import("./move-stage-form");

    render(<MoveStageForm currentStage="PROPOSAL" prospectId="prospect_1" />);

    fireEvent.change(screen.getByLabelText("Move to"), {
      target: { value: "WON" },
    });

    expect(
      screen.getByLabelText("Deal value (USD)").hasAttribute("required")
    ).toBe(true);
    expect(
      screen.getByLabelText("Actual close date").hasAttribute("required")
    ).toBe(true);
    expect(screen.queryByLabelText("Loss reason")).toBeNull();
  });

  it("reveals the required loss reason only for Lost", async () => {
    const { MoveStageForm } = await import("./move-stage-form");

    render(<MoveStageForm currentStage="PROPOSAL" prospectId="prospect_2" />);

    fireEvent.change(screen.getByLabelText("Move to"), {
      target: { value: "LOST" },
    });

    expect(screen.getByLabelText("Loss reason").hasAttribute("required")).toBe(
      true
    );
    expect(screen.queryByLabelText("Deal value (USD)")).toBeNull();
    expect(screen.queryByLabelText("Actual close date")).toBeNull();
  });

  it("announces pending and returned validation feedback", async () => {
    let resolveAction: (value: unknown) => void = () => undefined;
    moveProspectStageMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAction = resolve;
        })
    );
    const { MoveStageForm } = await import("./move-stage-form");

    render(<MoveStageForm currentStage="NEW" prospectId="prospect_3" />);
    const destination = screen.getByLabelText("Move to");
    fireEvent.change(destination, { target: { value: "CONTACTED" } });
    fireEvent.click(screen.getByRole("button", { name: "Move prospect" }));

    const pendingButton = await screen.findByRole("button", {
      name: "Moving…",
    });
    expect(pendingButton.hasAttribute("disabled")).toBe(true);

    await act(async () => {
      resolveAction({
        fieldErrors: { destination: ["Choose a different stage."] },
        message: "Check the highlighted fields.",
        status: "error",
      });
      await Promise.resolve();
    });

    expect(destination.getAttribute("aria-invalid")).toBe("true");
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Check the highlighted fields."
    );
    expect(screen.getByText("Choose a different stage.")).toBeTruthy();
  });

  it("submits only the ordinary transition fields after leaving Won", async () => {
    let submittedEntries: [string, FormDataEntryValue][] = [];
    moveProspectStageMock.mockImplementation(
      (_state: unknown, formData: FormData) => {
        submittedEntries = Array.from(formData.entries());
        return Promise.resolve({
          message: "Prospect moved to Contacted.",
          status: "success",
        });
      }
    );
    const { MoveStageForm } = await import("./move-stage-form");

    render(<MoveStageForm currentStage="PROPOSAL" prospectId="prospect_4" />);
    const destination = screen.getByLabelText("Move to");
    fireEvent.change(destination, { target: { value: "WON" } });
    fireEvent.change(screen.getByLabelText("Deal value (USD)"), {
      target: { value: "2500" },
    });
    fireEvent.change(screen.getByLabelText("Actual close date"), {
      target: { value: "2026-08-04" },
    });
    fireEvent.change(destination, { target: { value: "CONTACTED" } });
    fireEvent.click(screen.getByRole("button", { name: "Move prospect" }));

    await waitFor(() => {
      expect(submittedEntries).toEqual([
        ["prospectId", "prospect_4"],
        ["destination", "CONTACTED"],
      ]);
    });
  });
});

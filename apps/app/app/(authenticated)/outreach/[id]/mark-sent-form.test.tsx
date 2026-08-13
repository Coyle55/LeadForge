import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

const FOLLOW_UP_TEXT_PATTERN = /Follow-up suggestion/;

const markOutreachSentMock = vi.fn();

vi.mock("../../../actions/outreach", () => ({
  markOutreachSent: markOutreachSentMock,
}));

vi.mock("./follow-up-suggestion", () => ({
  FollowUpSuggestion: ({ businessName }: { businessName: string }) => (
    <p>Follow-up suggestion for {businessName}</p>
  ),
}));

beforeEach(() => {
  markOutreachSentMock.mockReset();
});

describe("MarkSentForm", () => {
  it("shows a mark-as-sent button for a completed draft and never calls the action on render", async () => {
    const { MarkSentForm } = await import("./mark-sent-form");

    render(
      <MarkSentForm
        businessName="Acme"
        draftId="draft_1"
        prospectId="prospect_1"
        sentAt={null}
        sentBody={null}
        sentSubject={null}
        status="COMPLETED"
      />
    );

    expect(screen.getByRole("button", { name: "Mark as sent" })).toBeTruthy();
    expect(markOutreachSentMock).not.toHaveBeenCalled();
  });

  it("marks a draft sent on click and reveals the follow-up suggestion only after success", async () => {
    markOutreachSentMock.mockResolvedValue({
      status: "success",
      message: "Outreach marked as sent.",
    });
    const { MarkSentForm } = await import("./mark-sent-form");

    render(
      <MarkSentForm
        businessName="Acme"
        draftId="draft_1"
        prospectId="prospect_1"
        sentAt={null}
        sentBody={null}
        sentSubject={null}
        status="COMPLETED"
      />
    );

    expect(screen.queryByText(FOLLOW_UP_TEXT_PATTERN)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mark as sent" }));

    await waitFor(() =>
      expect(markOutreachSentMock).toHaveBeenCalledWith("draft_1")
    );
    await waitFor(() =>
      expect(screen.getByText("Follow-up suggestion for Acme")).toBeTruthy()
    );
  });

  it("surfaces an error message without revealing the follow-up suggestion on failure", async () => {
    markOutreachSentMock.mockResolvedValue({
      status: "error",
      message: "Completed outreach draft not found.",
    });
    const { MarkSentForm } = await import("./mark-sent-form");

    render(
      <MarkSentForm
        businessName="Acme"
        draftId="draft_1"
        prospectId="prospect_1"
        sentAt={null}
        sentBody={null}
        sentSubject={null}
        status="COMPLETED"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Mark as sent" }));

    await waitFor(() =>
      expect(
        screen.getByText("Completed outreach draft not found.")
      ).toBeTruthy()
    );
    expect(screen.queryByText(FOLLOW_UP_TEXT_PATTERN)).toBeNull();
  });

  it("renders the persisted sent snapshot as read-only and does not surface the follow-up suggestion on a fresh mount", async () => {
    const { MarkSentForm } = await import("./mark-sent-form");

    render(
      <MarkSentForm
        businessName="Acme"
        draftId="draft_1"
        prospectId="prospect_1"
        sentAt={new Date("2026-08-04T15:00:00.000Z")}
        sentBody="Sent body copy"
        sentSubject="Sent subject copy"
        status="SENT"
      />
    );

    expect(screen.getByText("Sent subject copy")).toBeTruthy();
    expect(screen.getByText("Sent body copy")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mark as sent" })).toBeNull();
    expect(screen.queryByText(FOLLOW_UP_TEXT_PATTERN)).toBeNull();
    expect(markOutreachSentMock).not.toHaveBeenCalled();
  });
});

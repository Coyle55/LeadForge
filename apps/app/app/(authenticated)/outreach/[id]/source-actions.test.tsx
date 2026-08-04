import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../actions/outreach", () => ({
  generateOutreachDraft: vi.fn(),
}));

describe("DraftSourceActions", () => {
  it("links directly to grounded audit evidence and offers regeneration", async () => {
    const { DraftSourceActions } = await import("./source-actions");

    render(
      <DraftSourceActions
        auditId="audit_1"
        evidence={[
          { key: "contact_path", label: "Contact paths" },
          { key: "mobile_viewport", label: "Mobile viewport" },
        ]}
        recommendationId="recommendation_1"
      />
    );

    expect(
      screen
        .getByRole("link", { name: "View audit evidence" })
        .getAttribute("href")
    ).toBe("/audits/audit_1#contact_path");
    expect(
      screen.getByRole("link", { name: "Contact paths" }).getAttribute("href")
    ).toBe("/audits/audit_1#contact_path");
    expect(
      screen.getByRole("link", { name: "Mobile viewport" }).getAttribute("href")
    ).toBe("/audits/audit_1#mobile_viewport");
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeTruthy();
  });
});

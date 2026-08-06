import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoveredProspect } from "../../lib/discovery/types";
import { getIneligibilityReason, isImportEligible } from "./discover-results";

const baseCandidate: DiscoveredProspect = {
  businessName: "Acme Plumbing",
  confidence: "HIGH",
  discoveryId: "disc_1",
  sourceUrls: ["https://example.com/source"],
  websiteUrl: "https://acmeplumbing.example.com",
  websiteVerified: true,
};

describe("isImportEligible", () => {
  it("is eligible with a verified website and no duplicate", () => {
    expect(isImportEligible(baseCandidate, {})).toBe(true);
  });

  it("is ineligible when the website is not verified", () => {
    expect(
      isImportEligible({ ...baseCandidate, websiteVerified: false }, {})
    ).toBe(false);
  });

  it("is ineligible when there is no website url", () => {
    expect(
      isImportEligible(
        { ...baseCandidate, websiteUrl: undefined, websiteVerified: true },
        {}
      )
    ).toBe(false);
  });

  it("is ineligible when the website url is whitespace-only", () => {
    expect(isImportEligible({ ...baseCandidate, websiteUrl: "   " }, {})).toBe(
      false
    );
  });

  it("is ineligible when a duplicate prospect id is set", () => {
    expect(
      isImportEligible(baseCandidate, {
        [baseCandidate.discoveryId]: "prospect_1",
      })
    ).toBe(false);
  });

  it("is eligible when the duplicate id is explicitly null", () => {
    expect(
      isImportEligible(baseCandidate, { [baseCandidate.discoveryId]: null })
    ).toBe(true);
  });
});

describe("getIneligibilityReason", () => {
  it("returns null for an eligible candidate", () => {
    expect(getIneligibilityReason(baseCandidate, {})).toBeNull();
  });

  it("prioritizes the duplicate reason over website issues", () => {
    expect(
      getIneligibilityReason(
        { ...baseCandidate, websiteVerified: false },
        { [baseCandidate.discoveryId]: "prospect_1" }
      )
    ).toBe("Already imported");
  });

  it("reports a missing website", () => {
    expect(
      getIneligibilityReason({ ...baseCandidate, websiteUrl: undefined }, {})
    ).toBe("No website found");
  });

  it("reports an unverified website", () => {
    expect(
      getIneligibilityReason({ ...baseCandidate, websiteVerified: false }, {})
    ).toBe("Website not verified");
  });
});

const { importProspectsMock, importAndAuditProspectsMock } = vi.hoisted(() => ({
  importAndAuditProspectsMock: vi.fn(),
  importProspectsMock: vi.fn(),
}));
vi.mock("../../actions/discovery", () => ({
  importAndAuditProspects: importAndAuditProspectsMock,
  importProspects: importProspectsMock,
}));

const batchContext = {
  location: "Cincinnati, OH",
  provider: "PERPLEXITY_GATEWAY_SEARCH",
  query: "plumbers",
  reasoningModel: "test-model",
  requestedCount: 2,
  returnedCount: 2,
};

const duplicateCandidate: DiscoveredProspect = {
  ...baseCandidate,
  businessName: "Already Here Co",
  discoveryId: "disc_2",
};

afterEach(cleanup);
beforeEach(() => {
  importProspectsMock.mockReset();
  importAndAuditProspectsMock.mockReset();
});

describe("DiscoverResults", () => {
  it("only selects eligible rows via select all, and disables ineligible rows", async () => {
    const { DiscoverResults } = await import("./discover-results");

    render(
      <DiscoverResults
        batchContext={batchContext}
        candidates={[baseCandidate, duplicateCandidate]}
        duplicateProspectIds={{
          [duplicateCandidate.discoveryId]: "prospect_9",
        }}
      />
    );

    const selectAll = screen.getByLabelText("Select all eligible candidates");
    const eligibleCheckbox = screen.getByLabelText(
      `Select ${baseCandidate.businessName}`
    );
    const ineligibleCheckbox = screen.getByLabelText("Already imported");

    expect(ineligibleCheckbox.hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByText("Already Imported")[0]).toBeTruthy();

    fireEvent.click(selectAll);

    expect(eligibleCheckbox.getAttribute("data-state")).toBe("checked");
    expect(ineligibleCheckbox.getAttribute("data-state")).not.toBe("checked");
  });
});

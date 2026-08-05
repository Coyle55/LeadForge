import { describe, expect, it } from "vitest";
import {
  formatDealValueForInput,
  prepareDealFormData,
} from "./pipeline-deal-form-state";

describe("pipeline deal form state", () => {
  it("displays integer cents as dollars with exactly two decimals", () => {
    expect(formatDealValueForInput(125_050)).toBe("1250.50");
    expect(formatDealValueForInput(50)).toBe("0.50");
    expect(formatDealValueForInput(null)).toBe("");
  });

  it("serializes only the supported deal fields in dollar form", () => {
    const input = new FormData();
    input.set("prospectId", "prospect_1");
    input.set("value", "1250.50");
    input.set("expectedCloseDate", "2026-10-20");
    input.set("lossReason", "must not be forwarded");

    expect(Object.fromEntries(prepareDealFormData(input).entries())).toEqual({
      expectedCloseDate: "2026-10-20",
      prospectId: "prospect_1",
      value: "1250.50",
    });
  });
});

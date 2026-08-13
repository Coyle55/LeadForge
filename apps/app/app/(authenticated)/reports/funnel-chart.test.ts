import { describe, expect, it } from "vitest";
import { formatConversionRate, hasFunnelData } from "./funnel-chart";

describe("hasFunnelData", () => {
  it("is false with an empty funnel and zero terminal totals", () => {
    expect(
      hasFunnelData([{ stage: "NEW", count: 0 }], { won: 0, lost: 0 })
    ).toBe(false);
  });

  it("is true when any funnel stage or terminal total is non-zero", () => {
    expect(
      hasFunnelData([{ stage: "NEW", count: 0 }], { won: 1, lost: 0 })
    ).toBe(true);
  });
});

describe("formatConversionRate", () => {
  it("renders a dash when the rate is null", () => {
    expect(formatConversionRate(null)).toBe("—");
  });

  it("rounds a normal rate to a whole percentage", () => {
    expect(formatConversionRate(0.6)).toBe("60%");
  });

  it("clamps a rate above 1 to 100%, e.g. reachedFrom: 5, reachedTo: 8", () => {
    const rate = 8 / 5;
    expect(rate).toBeGreaterThan(1);
    expect(formatConversionRate(rate)).toBe("100%");
  });
});

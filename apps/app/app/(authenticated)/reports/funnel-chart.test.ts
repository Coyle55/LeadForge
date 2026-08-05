import { describe, expect, it } from "vitest";
import { hasFunnelData } from "./funnel-chart";

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

import { describe, expect, it } from "vitest";
import { hasTrendData } from "./trend-chart";

describe("hasTrendData", () => {
  it("is false when every series value is zero across all points", () => {
    expect(
      hasTrendData(
        [{ label: "Jul 2026", month: "2026-07", created: 0, completed: 0 }],
        ["created", "completed"]
      )
    ).toBe(false);
  });

  it("is true when any series value is non-zero", () => {
    expect(
      hasTrendData(
        [{ label: "Jul 2026", month: "2026-07", created: 2, completed: 0 }],
        ["created", "completed"]
      )
    ).toBe(true);
  });
});

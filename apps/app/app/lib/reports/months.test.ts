import { describe, expect, it } from "vitest";
import { getTrailingMonths, sumByMonth } from "./months";

describe("getTrailingMonths", () => {
  it("returns UTC month buckets ending with the current month, oldest first", () => {
    const months = getTrailingMonths(new Date("2026-08-05T12:00:00.000Z"), 3);
    expect(months.map((m) => m.key)).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(months.map((m) => m.label)).toEqual([
      "Jun 2026",
      "Jul 2026",
      "Aug 2026",
    ]);
    expect(months[2].start).toEqual(new Date("2026-08-01T00:00:00.000Z"));
    expect(months[2].end).toEqual(new Date("2026-09-01T00:00:00.000Z"));
  });

  it("crosses a year boundary correctly", () => {
    const months = getTrailingMonths(new Date("2026-01-15T00:00:00.000Z"), 2);
    expect(months.map((m) => m.key)).toEqual(["2025-12", "2026-01"]);
  });
});

describe("sumByMonth", () => {
  const months = getTrailingMonths(new Date("2026-08-05T00:00:00.000Z"), 2);

  it("counts items per month by default", () => {
    const items = [
      { at: new Date("2026-07-10T00:00:00.000Z") },
      { at: new Date("2026-08-01T00:00:00.000Z") },
      { at: new Date("2026-08-20T00:00:00.000Z") },
    ];
    expect(sumByMonth(months, items, (item) => item.at)).toEqual([1, 2]);
  });

  it("sums a custom value and ignores dates outside every bucket", () => {
    const items = [
      { at: new Date("2026-07-10T00:00:00.000Z"), value: 500 },
      { at: new Date("2026-08-01T00:00:00.000Z"), value: 250 },
      { at: new Date("2026-01-01T00:00:00.000Z"), value: 999 },
    ];
    expect(
      sumByMonth(
        months,
        items,
        (item) => item.at,
        (item) => item.value
      )
    ).toEqual([500, 250]);
  });
});

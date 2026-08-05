import { describe, expect, it } from "vitest";
import {
  dateToZonedLocalInput,
  getTaskDayBounds,
  zonedLocalInputToIso,
} from "./time";

describe("task timezone helpers", () => {
  it("uses exact New York midnight boundaries during standard time", () => {
    expect(getTaskDayBounds(new Date("2026-01-15T15:00:00Z"))).toEqual({
      start: new Date("2026-01-15T05:00:00Z"),
      end: new Date("2026-01-16T05:00:00Z"),
    });
  });

  it("uses exact New York midnight boundaries during daylight time", () => {
    expect(getTaskDayBounds(new Date("2026-07-15T15:00:00Z"))).toEqual({
      start: new Date("2026-07-15T04:00:00Z"),
      end: new Date("2026-07-16T04:00:00Z"),
    });
  });

  it("uses the New York calendar date when UTC is already tomorrow", () => {
    expect(getTaskDayBounds(new Date("2026-01-16T03:30:00Z"))).toEqual({
      start: new Date("2026-01-15T05:00:00Z"),
      end: new Date("2026-01-16T05:00:00Z"),
    });
  });

  it("returns a 23-hour day across the spring-forward transition", () => {
    const bounds = getTaskDayBounds(new Date("2026-03-08T16:00:00Z"));

    expect(bounds).toEqual({
      start: new Date("2026-03-08T05:00:00Z"),
      end: new Date("2026-03-09T04:00:00Z"),
    });
    expect(bounds.end.getTime() - bounds.start.getTime()).toBe(
      23 * 60 * 60 * 1000
    );
  });

  it("returns a 25-hour day across the fall-back transition", () => {
    const bounds = getTaskDayBounds(new Date("2026-11-01T17:00:00Z"));

    expect(bounds).toEqual({
      start: new Date("2026-11-01T04:00:00Z"),
      end: new Date("2026-11-02T05:00:00Z"),
    });
    expect(bounds.end.getTime() - bounds.start.getTime()).toBe(
      25 * 60 * 60 * 1000
    );
  });

  it.each([
    ["2026-01-15T09:30", "2026-01-15T14:30:00.000Z"],
    ["2026-07-15T09:30", "2026-07-15T13:30:00.000Z"],
  ])("converts %s from New York wall time to an ISO instant", (value, iso) => {
    expect(zonedLocalInputToIso(value)).toBe(iso);
  });

  it("chooses the first occurrence of an ambiguous fall-back wall time", () => {
    expect(zonedLocalInputToIso("2026-11-01T01:30")).toBe(
      "2026-11-01T05:30:00.000Z"
    );
  });

  it.each([
    "2026-03-08T02:00",
    "2026-03-08T02:30",
    "2026-03-08T02:59",
  ])("rejects nonexistent spring-forward wall time %s", (value) => {
    expect(() => zonedLocalInputToIso(value)).toThrow(RangeError);
  });

  it.each([
    ["2026-01-15T14:30:00Z", "2026-01-15T09:30"],
    ["2026-07-15T13:30:00Z", "2026-07-15T09:30"],
    ["2026-11-01T05:30:00Z", "2026-11-01T01:30"],
    ["2026-11-01T06:30:00Z", "2026-11-01T01:30"],
  ])("formats %s for a New York datetime-local input", (iso, input) => {
    expect(dateToZonedLocalInput(new Date(iso))).toBe(input);
  });
});

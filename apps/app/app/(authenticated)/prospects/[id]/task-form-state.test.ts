import { describe, expect, it } from "vitest";
import { prepareTaskFormData } from "./task-form-state";

describe("task form submission state", () => {
  it.each([
    ["2026-01-15T09:30", "2026-01-15T14:30:00.000Z"],
    ["2026-07-15T09:30", "2026-07-15T13:30:00.000Z"],
  ])("serializes New York wall time %s to the exact ISO instant", (localInput, iso) => {
    const input = new FormData();
    input.set("title", "Call the buyer");
    input.set("dueAtLocal", localInput);
    input.set("priority", "HIGH");

    expect(Object.fromEntries(prepareTaskFormData(input).entries())).toEqual({
      dueAt: iso,
      priority: "HIGH",
      title: "Call the buyer",
    });
  });

  it("rejects a nonexistent New York wall time", () => {
    const input = new FormData();
    input.set("title", "Call the buyer");
    input.set("dueAtLocal", "2026-03-08T02:30");
    input.set("priority", "MEDIUM");

    expect(() => prepareTaskFormData(input)).toThrow(
      "Local time does not exist in America/New_York"
    );
  });

  it("never forwards prospect linkage or status fields while editing", () => {
    const input = new FormData();
    input.set("title", "Call the buyer");
    input.set("dueAtLocal", "2026-08-04T09:30");
    input.set("priority", "LOW");
    input.set("prospectId", "prospect_other");
    input.set("status", "COMPLETED");

    expect([...prepareTaskFormData(input).keys()]).toEqual([
      "title",
      "dueAt",
      "priority",
    ]);
  });
});

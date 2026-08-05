import { describe, expect, it } from "vitest";
import { type TaskInput, taskInputSchema } from "./index";

describe("task validation", () => {
  it("trims a task title and parses an offset-aware due date", () => {
    const result: TaskInput = taskInputSchema.parse({
      title: " Follow up with Acme ",
      dueAt: "2026-08-04T09:30:00-04:00",
      priority: "HIGH",
    });

    expect(result).toEqual({
      title: "Follow up with Acme",
      dueAt: new Date("2026-08-04T13:30:00.000Z"),
      priority: "HIGH",
    });
  });

  it.each([
    "",
    " ",
    "t".repeat(161),
  ])("rejects a task title outside the allowed bounds", (title) => {
    expect(
      taskInputSchema.safeParse({
        title,
        dueAt: "2026-08-04T09:30:00-04:00",
        priority: "MEDIUM",
      }).success
    ).toBe(false);
  });

  it("rejects a task priority outside the fixed set", () => {
    expect(
      taskInputSchema.safeParse({
        title: "Follow up with Acme",
        dueAt: "2026-08-04T09:30:00-04:00",
        priority: "URGENT",
      }).success
    ).toBe(false);
  });

  it.each([
    "2026-08-04",
    "2026-08-04T09:30:00",
    "not-a-date",
  ])("rejects a due date without a valid ISO offset datetime", (dueAt) => {
    expect(
      taskInputSchema.safeParse({
        title: "Follow up with Acme",
        dueAt,
        priority: "LOW",
      }).success
    ).toBe(false);
  });
});

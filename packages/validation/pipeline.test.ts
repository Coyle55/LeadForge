import { describe, expect, it } from "vitest";
import {
  dealEditSchema,
  type PipelineTransitionInput,
  pipelineTransitionSchema,
} from "./index";

describe("pipeline validation", () => {
  it("converts a Won transition's currency and date-only fields", () => {
    const result: PipelineTransitionInput = pipelineTransitionSchema.parse({
      destination: "WON",
      value: "1250.50",
      actualCloseDate: "2026-08-04",
      lossReason: "",
    });

    expect(result).toEqual({
      destination: "WON",
      valueCents: 125_050,
      actualCloseDate: new Date("2026-08-04T12:00:00.000Z"),
      lossReason: null,
    });
  });

  it("converts blank optional deal fields to null", () => {
    expect(dealEditSchema.parse({ value: "", expectedCloseDate: "" })).toEqual({
      valueCents: null,
      expectedCloseDate: null,
    });
  });

  it("rejects an unknown pipeline destination", () => {
    expect(
      pipelineTransitionSchema.safeParse({
        destination: "QUALIFIED",
        value: "",
        actualCloseDate: "",
        lossReason: "",
      }).success
    ).toBe(false);
  });

  it.each([
    "0",
    "0.00",
    "-1",
  ])("rejects non-positive Won currency %s", (value) => {
    expect(
      pipelineTransitionSchema.safeParse({
        destination: "WON",
        value,
        actualCloseDate: "2026-08-04",
        lossReason: "",
      }).success
    ).toBe(false);
  });

  it("rejects Won currency above PostgreSQL's integer range", () => {
    expect(
      pipelineTransitionSchema.safeParse({
        destination: "WON",
        value: "21474836.48",
        actualCloseDate: "2026-08-04",
        lossReason: "",
      }).success
    ).toBe(false);
  });

  it("rejects currency values with more than two decimal places", () => {
    expect(
      dealEditSchema.safeParse({
        value: "12.345",
        expectedCloseDate: "2026-08-04",
      }).success
    ).toBe(false);
  });

  it.each([
    {
      destination: "WON",
      value: "",
      actualCloseDate: "2026-08-04",
      lossReason: "",
    },
    {
      destination: "WON",
      value: "1250.50",
      actualCloseDate: "",
      lossReason: "",
    },
  ])("rejects a Won transition missing a required closing field", (input) => {
    expect(pipelineTransitionSchema.safeParse(input).success).toBe(false);
  });

  it.each([
    "",
    " ",
    "l".repeat(501),
  ])("rejects a Lost transition with an invalid loss reason", (lossReason) => {
    expect(
      pipelineTransitionSchema.safeParse({
        destination: "LOST",
        value: "",
        actualCloseDate: "",
        lossReason,
      }).success
    ).toBe(false);
  });

  it.each([
    "2026-02-30",
    "2026/08/04",
    "not-a-date",
  ])("rejects malformed deal date %s", (expectedCloseDate) => {
    expect(
      dealEditSchema.safeParse({ value: "1250.50", expectedCloseDate }).success
    ).toBe(false);
  });
});

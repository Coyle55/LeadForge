import { describe, expect, it } from "vitest";
import { validateInterpretationOutput } from "./schema";

const allowedNumbers = new Set(["0", "1", "2", "100", "72", "60", "80", "70", "75", "65", "15", "5"]);
const expectedServiceCategories = ["LEAD_CAPTURE_REPAIR"];

const valid = {
  summary:
    "This website presents a strong addressable opportunity supported by several audit findings, scoring 72 overall.",
  strongestIssue: "The contact-path check failed, worth 15 points.",
  practicalImpact:
    "Missing contact paths limit clear conversion routes for potential customers.",
  suggestedOffer: "A focused lead-capture repair engagement.",
  confidence: "MEDIUM" as const,
  warnings: [],
  recommendations: [
    {
      serviceCategory: "LEAD_CAPTURE_REPAIR" as const,
      title: "Repair your lead-capture path",
      rationale:
        "The contact-path check failed, which limits clear conversion routes for visitors.",
      action: "Add a prominent, working contact action to the header and service pages.",
    },
  ],
};

describe("validateInterpretationOutput", () => {
  it("accepts prose whose numbers are all present in allowedNumbers and whose recommendations exactly match", () => {
    expect(
      validateInterpretationOutput(valid, allowedNumbers, expectedServiceCategories)
    ).toEqual(valid);
  });

  it("rejects malformed shapes", () => {
    expect(() =>
      validateInterpretationOutput(
        { ...valid, confidence: "URGENT" },
        allowedNumbers,
        expectedServiceCategories
      )
    ).toThrow();
  });

  it("rejects prose that introduces a number absent from allowedNumbers", () => {
    const withInventedNumber = {
      ...valid,
      summary: `${valid.summary} Traffic could rise 4200%.`,
    };
    expect(() =>
      validateInterpretationOutput(withInventedNumber, allowedNumbers, expectedServiceCategories)
    ).toThrow(/unlisted number/i);
  });

  it("rejects a number invented inside recommendation copy, not just the overall-summary fields", () => {
    const withInventedNumber = {
      ...valid,
      recommendations: [
        { ...valid.recommendations[0], action: `${valid.recommendations[0].action} Expect a 4200% lift.` },
      ],
    };
    expect(() =>
      validateInterpretationOutput(withInventedNumber, allowedNumbers, expectedServiceCategories)
    ).toThrow(/unlisted number/i);
  });

  it("accepts a percent-suffixed number when its bare form is allowed", () => {
    const withPercent = {
      ...valid,
      practicalImpact: `${valid.practicalImpact} This affects roughly 72% of the experience.`,
    };
    expect(
      validateInterpretationOutput(withPercent, allowedNumbers, expectedServiceCategories)
    ).toEqual(withPercent);
  });

  it("rejects recommendations missing an expected service category", () => {
    expect(() =>
      validateInterpretationOutput(
        { ...valid, recommendations: [] },
        allowedNumbers,
        expectedServiceCategories
      )
    ).toThrow(/expected service categories/i);
  });

  it("rejects recommendations that include an extra, unexpected service category", () => {
    const withExtra = {
      ...valid,
      recommendations: [
        ...valid.recommendations,
        {
          serviceCategory: "PERFORMANCE_OPTIMIZATION" as const,
          title: "Speed up key pages",
          rationale: "Server response time checks show room to improve load speed.",
          action: "Optimize the slowest server responses on key landing pages.",
        },
      ],
    };
    expect(() =>
      validateInterpretationOutput(withExtra, allowedNumbers, expectedServiceCategories)
    ).toThrow(/expected service categories/i);
  });

  it("rejects a recommendation whose service category is wrong even though the count matches", () => {
    const withWrongCategory = {
      ...valid,
      recommendations: [
        { ...valid.recommendations[0], serviceCategory: "BOOKING_INTEGRATION" as const },
      ],
    };
    expect(() =>
      validateInterpretationOutput(withWrongCategory, allowedNumbers, expectedServiceCategories)
    ).toThrow(/expected service categories/i);
  });

  it("rejects a duplicated service category even when the expected set would otherwise match", () => {
    const duplicated = {
      ...valid,
      recommendations: [valid.recommendations[0], valid.recommendations[0]],
    };
    expect(() =>
      validateInterpretationOutput(duplicated, allowedNumbers, expectedServiceCategories)
    ).toThrow(/expected service categories/i);
  });

  it("accepts zero recommendations when zero are expected", () => {
    const noRecommendations = { ...valid, recommendations: [] };
    expect(
      validateInterpretationOutput(noRecommendations, allowedNumbers, [])
    ).toEqual(noRecommendations);
  });
});

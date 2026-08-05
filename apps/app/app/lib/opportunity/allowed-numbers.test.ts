import { describe, expect, it } from "vitest";
import { buildAllowedNumbers } from "./allowed-numbers";
import type { RecommendationCandidate } from "./recommend";
import type { ScoringResult } from "./scoring";

const scoring: ScoringResult = {
  tier: "HIGH",
  overallScore: 72,
  categoryScores: {
    trust: 80,
    seo: 70,
    technical: 60,
    accessibility: 50,
    performance: 40,
  },
  scoringBreakdown: [
    { category: "TRUST", checkKey: "contact_path", points: 15 },
    { category: "SEO", checkKey: "structured_data", points: 1 },
  ],
  topReasons: [
    {
      category: "TRUST",
      checkKey: "contact_path",
      points: 15,
      evidence: { found: false },
    },
    {
      category: "SEO",
      checkKey: "structured_data",
      points: 1,
      evidence: { blocks: 0 },
    },
  ],
  disqualifiers: [],
};

const recommendations: RecommendationCandidate[] = [
  {
    serviceCategory: "LEAD_CAPTURE_REPAIR",
    weight: 5,
    effort: "LOW",
    impact: "MEDIUM",
    confidence: "MEDIUM",
    supportingCheckKeys: ["contact_path"],
  },
  {
    serviceCategory: "PERFORMANCE_OPTIMIZATION",
    weight: 3,
    effort: "MEDIUM",
    impact: "LOW",
    confidence: "LOW",
    supportingCheckKeys: ["server_response_time"],
  },
];

describe("buildAllowedNumbers", () => {
  it("always includes the universal bounds", () => {
    const result = buildAllowedNumbers(scoring, recommendations);
    expect(result).toEqual(expect.arrayContaining(["0", "1", "2", "100"]));
  });

  it("includes every computed number from a representative scoring/recommendation pair", () => {
    const result = buildAllowedNumbers(scoring, recommendations);
    const expected = [
      "72", // overallScore
      "80",
      "70",
      "60",
      "50",
      "40", // categoryScores
      "15",
      "1", // scoringBreakdown points
      "5",
      "3", // recommendation weights
    ];
    for (const value of expected) {
      expect(result).toContain(value);
    }
  });

  it("contains no duplicates, since it is built from a Set", () => {
    const result = buildAllowedNumbers(scoring, recommendations);
    expect(new Set(result).size).toBe(result.length);
    // "15" and "1" each appear more than once across categoryScores/
    // scoringBreakdown/topReasons but must only appear once in the output.
    expect(result.filter((value) => value === "15")).toHaveLength(1);
    expect(result.filter((value) => value === "1")).toHaveLength(1);
  });

  it("returns only the universal bounds for an empty scoring/recommendation pair", () => {
    const empty: ScoringResult = {
      tier: "LOW",
      overallScore: 0,
      categoryScores: {},
      scoringBreakdown: [],
      topReasons: [],
      disqualifiers: [],
    };
    const result = buildAllowedNumbers(empty, []);
    expect(new Set(result)).toEqual(new Set(["0", "1", "2", "100"]));
  });
});

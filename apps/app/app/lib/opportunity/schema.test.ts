import { describe, expect, it } from "vitest";
import { validateOpportunityOutput } from "./schema";

const valid = {
  overallScore: 72,
  categoryScores: { accessibility: 60, trust: 80, seo: 70, technical: 75, performance: 65 },
  executiveSummary: "This website presents a strong addressable opportunity supported by several audit findings.",
  overallRationale: "Trust and technical findings create the clearest near-term opportunity while several checks already pass.",
  recommendations: [
    { title: "Strengthen contact paths", impact: "HIGH", effort: "LOW", rationale: "The contact-path check failed and limits clear conversion routes.", action: "Add a prominent contact action to the header and service pages.", auditCheckKeys: ["contact_path"] },
    { title: "Add structured data", impact: "MEDIUM", effort: "MEDIUM", rationale: "The structured-data check indicates no discoverable business schema.", action: "Publish valid LocalBusiness JSON-LD matching visible business details.", auditCheckKeys: ["structured_data"] },
    { title: "Improve page descriptions", impact: "MEDIUM", effort: "LOW", rationale: "Missing descriptions weaken how audited pages communicate their purpose.", action: "Write unique descriptions for each audited page based on its service intent.", auditCheckKeys: ["meta_description"] },
  ],
};

describe("validateOpportunityOutput", () => {
  it("accepts a complete evidence-linked result", () => {
    expect(validateOpportunityOutput(valid, new Set(["contact_path", "structured_data", "meta_description"]))).toEqual(valid);
  });

  it("rejects scores and references outside the source audit", () => {
    expect(() => validateOpportunityOutput({ ...valid, overallScore: 101 }, new Set(["contact_path"]))).toThrow();
    expect(() => validateOpportunityOutput(valid, new Set(["contact_path"]))).toThrow();
  });

  it("rejects duplicate recommendation titles", () => {
    const duplicate = { ...valid, recommendations: [valid.recommendations[0], { ...valid.recommendations[1], title: "STRENGTHEN CONTACT PATHS" }, valid.recommendations[2]] };
    expect(() => validateOpportunityOutput(duplicate, new Set(["contact_path", "structured_data", "meta_description"]))).toThrow();
  });
});

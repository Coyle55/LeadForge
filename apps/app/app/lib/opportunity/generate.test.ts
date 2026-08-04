import { describe, expect, it, vi } from "vitest";
import { generateOpportunity, OpportunityGenerationError } from "./generate";
import { OPPORTUNITY_PROMPT_VERSION } from "./prompt";

const input = {
  prospectName: "Acme",
  hostname: "example.com",
  audit: {
    auditedAt: "2026-08-04T12:00:00.000Z",
    pagesAudited: 1,
    pagesAttempted: 1,
    durationMs: 100,
  },
  checks: [
    {
      key: "contact_path",
      category: "TRUST",
      status: "FAIL",
      summary: "Missing",
      evidence: { found: false },
    },
    {
      key: "structured_data",
      category: "SEO",
      status: "FAIL",
      summary: "Missing",
      evidence: { blocks: 0 },
    },
    {
      key: "meta_description",
      category: "ACCESSIBILITY",
      status: "WARNING",
      summary: "Partial",
      evidence: { pages: 2 },
    },
  ],
};

const output = {
  overallScore: 72,
  categoryScores: {
    accessibility: 60,
    trust: 80,
    seo: 70,
    technical: 75,
    performance: 65,
  },
  executiveSummary:
    "This website presents a strong addressable opportunity supported by several audit findings.",
  overallRationale:
    "Trust and technical findings create the clearest near-term opportunity while several checks already pass.",
  recommendations: [
    {
      title: "Strengthen contact paths",
      impact: "HIGH",
      effort: "LOW",
      rationale:
        "The contact-path check failed and limits clear conversion routes.",
      action: "Add a prominent contact action to the header and service pages.",
      auditCheckKeys: ["contact_path"],
    },
    {
      title: "Add structured data",
      impact: "MEDIUM",
      effort: "MEDIUM",
      rationale:
        "The structured-data check indicates no discoverable business schema.",
      action:
        "Publish valid LocalBusiness JSON-LD matching visible business details.",
      auditCheckKeys: ["structured_data"],
    },
    {
      title: "Improve page descriptions",
      impact: "MEDIUM",
      effort: "LOW",
      rationale:
        "Missing descriptions weaken how audited pages communicate their purpose.",
      action:
        "Write unique descriptions for each audited page based on its service intent.",
      auditCheckKeys: ["meta_description"],
    },
  ],
};

describe("generateOpportunity", () => {
  it("uses the configured model, rubric, structured output, no retries, and bounded telemetry", async () => {
    const generate = vi.fn().mockResolvedValue({
      output,
      usage: { inputTokens: 100, outputTokens: 80 },
    });
    const result = await generateOpportunity(input, {
      model: "openai/test-model",
      generate,
      now: (() => {
        let time = 0;
        return () => (time += 25);
      })(),
    });
    expect(OPPORTUNITY_PROMPT_VERSION).toBe("opportunity-v1");
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai/test-model",
        maxRetries: 0,
        timeout: 30_000,
        temperature: 0,
      })
    );
    expect(generate.mock.calls[0]?.[0].system).toContain(
      "addressable sales opportunity"
    );
    expect(generate.mock.calls[0]?.[0].prompt).not.toContain("userId");
    expect(result).toMatchObject({
      output,
      inputTokens: 100,
      outputTokens: 80,
      durationMs: 25,
    });
  });

  it("maps rate limits and invalid evidence to safe typed errors", async () => {
    await expect(
      generateOpportunity(input, {
        model: "test",
        generate: vi
          .fn()
          .mockRejectedValue(
            Object.assign(new Error("provider secret"), { statusCode: 429 })
          ),
      })
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(
      generateOpportunity(input, {
        model: "test",
        generate: vi.fn().mockResolvedValue({
          output: {
            ...output,
            recommendations: output.recommendations.map((item, index) =>
              index ? item : { ...item, auditCheckKeys: ["invented"] }
            ),
          },
          usage: {},
        }),
      })
    ).rejects.toBeInstanceOf(OpportunityGenerationError);
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  generateInterpretation,
  InterpretationGenerationError,
} from "./generate";
import { INTERPRETATION_PROMPT_VERSION } from "./prompt";

const input = {
  prospectName: "Acme",
  hostname: "example.com",
  tier: "HIGH" as const,
  overallScore: 72,
  categoryScores: {
    accessibility: 60,
    trust: 80,
    seo: 70,
    technical: 75,
    performance: 65,
  },
  topReasons: [
    {
      category: "TRUST",
      checkKey: "contact_path",
      points: 15,
      evidence: { found: false },
    },
  ],
  recommendations: [
    {
      serviceCategory: "LEAD_CAPTURE_REPAIR",
      weight: 5,
      effort: "LOW",
      impact: "MEDIUM",
      confidence: "MEDIUM",
      supportingCheckKeys: ["contact_path"],
    },
  ],
  allowedNumbers: [
    "0",
    "1",
    "2",
    "100",
    "72",
    "60",
    "80",
    "70",
    "75",
    "65",
    "15",
    "5",
  ],
  expectedServiceCategories: ["LEAD_CAPTURE_REPAIR"],
};

const output = {
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
      serviceCategory: "LEAD_CAPTURE_REPAIR",
      title: "Repair your lead-capture path",
      rationale:
        "The contact-path check failed, which limits clear conversion routes for visitors.",
      action:
        "Add a prominent, working contact action to the header and service pages.",
    },
  ],
};

describe("generateInterpretation", () => {
  it("uses the configured model, bounded prompt, structured output, no retries, and bounded telemetry", async () => {
    const generate = vi.fn().mockResolvedValue({
      output,
      usage: { inputTokens: 100, outputTokens: 80 },
    });
    const result = await generateInterpretation(input, {
      model: "openai/test-model",
      generate,
      now: (() => {
        let time = 0;
        return () => (time += 25);
      })(),
    });
    expect(INTERPRETATION_PROMPT_VERSION).toBe("interpretation-v1");
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai/test-model",
        maxRetries: 0,
        timeout: 30_000,
        temperature: 0,
      })
    );
    expect(generate.mock.calls[0]?.[0].system).toContain(
      "ALREADY-COMPUTED deterministic score"
    );
    expect(generate.mock.calls[0]?.[0].prompt).not.toContain("userId");
    expect(result).toMatchObject({
      output,
      inputTokens: 100,
      outputTokens: 80,
      durationMs: 25,
    });
  });

  it("maps rate limits and unlisted numbers to safe typed errors", async () => {
    await expect(
      generateInterpretation(input, {
        model: "test",
        generate: vi
          .fn()
          .mockRejectedValue(
            Object.assign(new Error("provider secret"), { statusCode: 429 })
          ),
      })
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(
      generateInterpretation(input, {
        model: "test",
        generate: vi.fn().mockResolvedValue({
          output: {
            ...output,
            summary: `${output.summary} Traffic could rise 4200%.`,
          },
          usage: {},
        }),
      })
    ).rejects.toBeInstanceOf(InterpretationGenerationError);
  });

  it("classifies a service-category mismatch as INVALID_OUTPUT", async () => {
    await expect(
      generateInterpretation(input, {
        model: "test",
        generate: vi.fn().mockResolvedValue({
          output: { ...output, recommendations: [] },
          usage: {},
        }),
      })
    ).rejects.toMatchObject({ code: "INVALID_OUTPUT" });
  });
});

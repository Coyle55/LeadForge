import { describe, expect, it, vi } from "vitest";
import { DiscoveryGenerationError, generateDiscovery } from "./generate";
import { DISCOVERY_PROMPT_VERSION } from "./prompt";

const input = {
  businessType: "plumbers",
  location: "Cincinnati, OH",
  resultLimit: 10,
};

const validOutput = {
  candidates: [
    {
      businessName: "Ace Plumbing",
      websiteUrl: "https://www.aceplumbing.com/",
      sourceUrls: ["https://example.com/listing"],
      confidence: "HIGH",
    },
  ],
};

describe("generateDiscovery", () => {
  it("uses the configured model, discovery prompt, structured output, no retries, and bounded telemetry", async () => {
    const generate = vi.fn().mockResolvedValue({
      output: validOutput,
      usage: { inputTokens: 100, outputTokens: 80 },
    });
    const result = await generateDiscovery(input, {
      model: "anthropic/claude-haiku-4.5",
      generate,
      now: (() => {
        let time = 0;
        return () => (time += 25);
      })(),
    });

    expect(DISCOVERY_PROMPT_VERSION).toBe("discovery-v1");
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "anthropic/claude-haiku-4.5",
        maxRetries: 0,
        timeout: 30_000,
        temperature: 0,
        telemetry: { recordInputs: false, recordOutputs: false },
      })
    );
    expect(generate.mock.calls[0]?.[0].system).toContain(
      "LeadForge's business discovery assistant"
    );
    expect(generate.mock.calls[0]?.[0].prompt).toContain("plumbers");
    expect(generate.mock.calls[0]?.[0].prompt).toContain("Cincinnati, OH");
    expect(result).toMatchObject({
      candidates: validOutput.candidates,
      inputTokens: 100,
      outputTokens: 80,
      durationMs: 25,
    });
  });

  it("maps a 429 status code to RATE_LIMITED", async () => {
    await expect(
      generateDiscovery(input, {
        model: "test",
        generate: vi
          .fn()
          .mockRejectedValue(
            Object.assign(new Error("provider secret"), { statusCode: 429 })
          ),
      })
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("maps a timeout/abort error to TIMEOUT", async () => {
    await expect(
      generateDiscovery(input, {
        model: "test",
        generate: vi.fn().mockRejectedValue(new Error("Request timeout")),
      })
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("tolerates a non-object element in candidates without throwing", async () => {
    const result = await generateDiscovery(input, {
      model: "test",
      generate: vi.fn().mockResolvedValue({
        output: { candidates: [...validOutput.candidates, null] },
        usage: { inputTokens: 5, outputTokens: 5 },
      }),
    });
    expect(result.candidates).toHaveLength(2);
  });

  it("maps a malformed model output to INVALID_OUTPUT", async () => {
    await expect(
      generateDiscovery(input, {
        model: "test",
        generate: vi.fn().mockResolvedValue({
          output: { candidates: "not-an-array" },
          usage: {},
        }),
      })
    ).rejects.toMatchObject({ code: "INVALID_OUTPUT" });
  });

  it("maps any other error to GATEWAY_ERROR", async () => {
    await expect(
      generateDiscovery(input, {
        model: "test",
        generate: vi.fn().mockRejectedValue(new Error("something else broke")),
      })
    ).rejects.toBeInstanceOf(DiscoveryGenerationError);
    await expect(
      generateDiscovery(input, {
        model: "test",
        generate: vi.fn().mockRejectedValue(new Error("something else broke")),
      })
    ).rejects.toMatchObject({ code: "GATEWAY_ERROR" });
  });
});

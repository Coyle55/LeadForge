import { NoObjectGeneratedError } from "ai";
import { describe, expect, it, vi } from "vitest";
import { generateOutreach, OutreachGenerationError } from "./generate";
import { OUTREACH_PROMPT_VERSION } from "./prompt";
import type { OutreachInput } from "./types";

const input: OutreachInput = {
  recipientFirstName: "Jordan",
  businessName: "Acme",
  hostname: "acme.example",
  recommendation: {
    title: "Improve contact paths",
    rationale: "Visitors may not find a clear route to start a conversation.",
    action: "Add a prominent contact action to service pages.",
  },
  evidence: [
    {
      key: "contact_path",
      label: "Contact paths",
      status: "FAIL",
      summary: "A direct contact path was not found.",
      evidence: { found: false },
    },
  ],
  sender: {
    senderName: "Casey",
    companyName: "Northstar Studio",
    serviceOffered: "Website conversion optimization",
    valueProposition:
      "We help service businesses turn clearer websites into better sales conversations.",
    defaultCta: "Would a brief conversation next week be useful?",
  },
};

const output = {
  subject: "A quick thought about Acme",
  body: "Hi Jordan,\n\nI noticed a direct contact path was not found on Acme's website. That may make it harder for interested visitors to take the next step. We help service businesses make those next steps clearer. Would a brief conversation next week be useful?",
};

describe("generateOutreach", () => {
  it("sends the minimized input through the configured model and returns a validated draft with usage", async () => {
    const generate = vi.fn().mockResolvedValue({
      output,
      usage: { inputTokens: 100, outputTokens: 80 },
    });

    const result = await generateOutreach(input, {
      model: "openai/example-model",
      generate,
      now: (() => {
        let time = 0;
        return () => (time += 25);
      })(),
    });

    expect(OUTREACH_PROMPT_VERSION).toBe("outreach-v1");
    expect(generate).toHaveBeenCalledWith({
      model: "openai/example-model",
      output: expect.anything(),
      system: expect.stringContaining("one concrete observation"),
      prompt: JSON.stringify(input),
      temperature: 0,
      maxRetries: 0,
      timeout: 30_000,
      telemetry: { recordInputs: false, recordOutputs: false },
    });
    expect(result).toEqual({
      output,
      inputTokens: 100,
      outputTokens: 80,
      durationMs: 25,
    });
  });

  it("maps a provider 429 to a rate-limited failure", async () => {
    await expect(
      generateOutreach(input, {
        model: "test",
        generate: vi
          .fn()
          .mockRejectedValue(
            Object.assign(new Error("provider secret"), { statusCode: 429 })
          ),
      })
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it.each([
    new Error("request timeout"),
    new Error("The operation was aborted"),
  ])("maps timeout and abort failures to TIMEOUT", async (error) => {
    await expect(
      generateOutreach(input, {
        model: "test",
        generate: vi.fn().mockRejectedValue(error),
      })
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("maps malformed structured output to an invalid-output failure", async () => {
    await expect(
      generateOutreach(input, {
        model: "test",
        generate: vi.fn().mockResolvedValue({
          output: { subject: "A quick thought", body: "Too short" },
          usage: {},
        }),
      })
    ).rejects.toBeInstanceOf(OutreachGenerationError);

    await expect(
      generateOutreach(input, {
        model: "test",
        generate: vi.fn().mockResolvedValue({
          output: { subject: "A quick thought", body: "Too short" },
          usage: {},
        }),
      })
    ).rejects.toMatchObject({ code: "INVALID_OUTPUT" });
  });

  it("maps AI SDK structured-output failures to an invalid-output failure", async () => {
    const error = new NoObjectGeneratedError({
      message: "No object generated.",
      response: {
        id: "response-id",
        modelId: "test-model",
        timestamp: new Date(),
      },
      usage: {
        inputTokens: 0,
        inputTokenDetails: {
          noCacheTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
        outputTokens: 0,
        outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
        totalTokens: 0,
      },
      finishReason: "stop",
    });

    await expect(
      generateOutreach(input, {
        model: "test",
        generate: vi.fn().mockRejectedValue(error),
      })
    ).rejects.toMatchObject({ code: "INVALID_OUTPUT" });
  });

  it("maps unknown provider failures to a gateway failure", async () => {
    await expect(
      generateOutreach(input, {
        model: "test",
        generate: vi.fn().mockRejectedValue(new Error("provider secret")),
      })
    ).rejects.toMatchObject({ code: "GATEWAY_ERROR" });
  });
});

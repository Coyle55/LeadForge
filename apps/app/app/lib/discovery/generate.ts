import { gateway, generateText, isStepCount, Output } from "ai";
import { z } from "zod";
import { DISCOVERY_SYSTEM_PROMPT } from "./prompt";
import { discoveryModelOutputSchema } from "./schema";

const timeoutPattern = /timeout|abort/i;
const invalidOutputPattern = /zod|validation/i;

export type DiscoveryGenerationFailure =
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "GATEWAY_ERROR"
  | "INVALID_OUTPUT";

export class DiscoveryGenerationError extends Error {
  readonly code: DiscoveryGenerationFailure;
  constructor(code: DiscoveryGenerationFailure) {
    super(code);
    this.name = "DiscoveryGenerationError";
    this.code = code;
  }
}

interface GenerateResult {
  output: unknown;
  usage: { inputTokens?: number; outputTokens?: number };
}
type Generator = (options: Record<string, unknown>) => Promise<GenerateResult>;

export const generateDiscovery = async (
  input: { businessType: string; location: string; resultLimit: number },
  options: { model: string; generate?: Generator; now?: () => number }
) => {
  const now = options.now ?? Date.now;
  const started = now();
  try {
    const result = await (
      options.generate ?? (generateText as unknown as Generator)
    )({
      model: options.model,
      system: DISCOVERY_SYSTEM_PROMPT,
      prompt: `Business type: ${input.businessType}\nLocation: ${input.location}\nRequested result count: ${input.resultLimit}`,
      tools: {
        perplexity_search: gateway.tools.perplexitySearch({
          maxResults: 20,
          country: "US",
        }),
      },
      output: Output.object({ schema: discoveryModelOutputSchema }),
      // AI SDK docs (ai/docs/03-ai-sdk-core/10-generating-structured-data.mdx and
      // ai/docs/09-troubleshooting/14-tool-calling-with-structured-outputs.mdx) state
      // that structured-output generation via `output` counts as its own step on top
      // of the tool-calling loop, and `stopWhen` must budget for it. `isStepCount` is
      // only an upper bound the loop is allowed to reach -- the loop still stops as
      // soon as the model finishes without a further tool call, so a higher count
      // costs nothing when fewer steps are actually used. We budget for up to two
      // search tool-call rounds (e.g. an initial narrow search followed by a
      // broadened retry) plus one structured-output step: 2 + 1 (per the docs'
      // documented +1) + 1 headroom = 4.
      stopWhen: isStepCount(4),
      temperature: 0,
      maxRetries: 0,
      timeout: 30_000,
      telemetry: { recordInputs: false, recordOutputs: false },
    });
    const parsed = discoveryModelOutputSchema.parse(result.output);
    return {
      candidates: parsed.candidates,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      durationMs: now() - started,
    };
  } catch (error) {
    if (error instanceof DiscoveryGenerationError) {
      throw error;
    }
    if (
      typeof error === "object" &&
      error &&
      "statusCode" in error &&
      error.statusCode === 429
    ) {
      throw new DiscoveryGenerationError("RATE_LIMITED");
    }
    if (
      error instanceof Error &&
      timeoutPattern.test(`${error.name} ${error.message}`)
    ) {
      throw new DiscoveryGenerationError("TIMEOUT");
    }
    if (
      error instanceof z.ZodError ||
      (error instanceof Error &&
        invalidOutputPattern.test(`${error.name} ${error.message}`))
    ) {
      throw new DiscoveryGenerationError("INVALID_OUTPUT");
    }
    throw new DiscoveryGenerationError("GATEWAY_ERROR");
  }
};

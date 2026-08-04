import { generateText, Output } from "ai";
import { OPPORTUNITY_SYSTEM_PROMPT } from "./prompt";
import { opportunityOutputSchema, validateOpportunityOutput } from "./schema";

const timeoutPattern = /timeout|abort/i;
const invalidOutputPattern =
  /unknown audit evidence|duplicate recommendation|zod|validation/i;

export type OpportunityGenerationFailure =
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "GATEWAY_ERROR"
  | "INVALID_OUTPUT";

export class OpportunityGenerationError extends Error {
  readonly code: OpportunityGenerationFailure;
  constructor(code: OpportunityGenerationFailure) {
    super(code);
    this.name = "OpportunityGenerationError";
    this.code = code;
  }
}

interface GenerateResult {
  output: unknown;
  usage: { inputTokens?: number; outputTokens?: number };
}

type Generator = (options: Record<string, unknown>) => Promise<GenerateResult>;

export const generateOpportunity = async (
  input: { checks: Array<{ key: string }>; [key: string]: unknown },
  options: { model: string; generate?: Generator; now?: () => number }
) => {
  const now = options.now ?? Date.now;
  const started = now();
  try {
    const result = await (
      options.generate ?? (generateText as unknown as Generator)
    )({
      model: options.model,
      output: Output.object({ schema: opportunityOutputSchema }),
      system: OPPORTUNITY_SYSTEM_PROMPT,
      prompt: JSON.stringify(input),
      temperature: 0,
      maxRetries: 0,
      timeout: 30_000,
      telemetry: { recordInputs: false, recordOutputs: false },
    });
    const output = validateOpportunityOutput(
      result.output,
      new Set(input.checks.map(({ key }) => key))
    );
    return {
      output,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      durationMs: now() - started,
    };
  } catch (error) {
    if (error instanceof OpportunityGenerationError) {
      throw error;
    }
    if (
      typeof error === "object" &&
      error &&
      "statusCode" in error &&
      error.statusCode === 429
    ) {
      throw new OpportunityGenerationError("RATE_LIMITED");
    }
    if (
      error instanceof Error &&
      timeoutPattern.test(`${error.name} ${error.message}`)
    ) {
      throw new OpportunityGenerationError("TIMEOUT");
    }
    if (
      error instanceof Error &&
      invalidOutputPattern.test(`${error.name} ${error.message}`)
    ) {
      throw new OpportunityGenerationError("INVALID_OUTPUT");
    }
    throw new OpportunityGenerationError("GATEWAY_ERROR");
  }
};

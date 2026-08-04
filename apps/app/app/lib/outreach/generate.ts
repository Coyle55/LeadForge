import { generateText, NoObjectGeneratedError, Output } from "ai";
import { OUTREACH_SYSTEM_PROMPT } from "./prompt";
import { outreachOutputSchema, validateOutreachOutput } from "./schema";
import type { OutreachInput } from "./types";

const timeoutPattern = /timeout|abort/i;
const invalidOutputPattern = /zod|validation|output/i;

export type OutreachGenerationFailure =
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "GATEWAY_ERROR"
  | "INVALID_OUTPUT";

export class OutreachGenerationError extends Error {
  readonly code: OutreachGenerationFailure;

  constructor(code: OutreachGenerationFailure) {
    super(code);
    this.name = "OutreachGenerationError";
    this.code = code;
  }
}

interface GenerateResult {
  output: unknown;
  usage: { inputTokens?: number; outputTokens?: number };
}

type Generator = (options: Record<string, unknown>) => Promise<GenerateResult>;

export const generateOutreach = async (
  input: OutreachInput,
  options: { model: string; generate?: Generator; now?: () => number }
) => {
  const now = options.now ?? Date.now;
  const started = now();

  try {
    const result = await (
      options.generate ?? (generateText as unknown as Generator)
    )({
      model: options.model,
      output: Output.object({ schema: outreachOutputSchema }),
      system: OUTREACH_SYSTEM_PROMPT,
      prompt: JSON.stringify(input),
      temperature: 0,
      maxRetries: 0,
      timeout: 30_000,
      telemetry: { recordInputs: false, recordOutputs: false },
    });
    const output = validateOutreachOutput(result.output);

    return {
      output,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      durationMs: now() - started,
    };
  } catch (error) {
    if (error instanceof OutreachGenerationError) {
      throw error;
    }
    if (NoObjectGeneratedError.isInstance(error)) {
      throw new OutreachGenerationError("INVALID_OUTPUT");
    }
    if (
      typeof error === "object" &&
      error &&
      "statusCode" in error &&
      error.statusCode === 429
    ) {
      throw new OutreachGenerationError("RATE_LIMITED");
    }
    if (
      error instanceof Error &&
      timeoutPattern.test(`${error.name} ${error.message}`)
    ) {
      throw new OutreachGenerationError("TIMEOUT");
    }
    if (
      error instanceof Error &&
      invalidOutputPattern.test(`${error.name} ${error.message}`)
    ) {
      throw new OutreachGenerationError("INVALID_OUTPUT");
    }
    throw new OutreachGenerationError("GATEWAY_ERROR");
  }
};

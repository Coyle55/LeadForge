import { generateText, Output } from "ai";
import { INTERPRETATION_SYSTEM_PROMPT } from "./prompt";
import { interpretationOutputSchema, validateInterpretationOutput } from "./schema";

const timeoutPattern = /timeout|abort/i;
const invalidOutputPattern = /unlisted number|zod|validation|expected service categories/i;

export type InterpretationGenerationFailure =
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "GATEWAY_ERROR"
  | "INVALID_OUTPUT";

export class InterpretationGenerationError extends Error {
  readonly code: InterpretationGenerationFailure;
  constructor(code: InterpretationGenerationFailure) {
    super(code);
    this.name = "InterpretationGenerationError";
    this.code = code;
  }
}

interface GenerateResult {
  output: unknown;
  usage: { inputTokens?: number; outputTokens?: number };
}
type Generator = (options: Record<string, unknown>) => Promise<GenerateResult>;

export const generateInterpretation = async (
  input: {
    allowedNumbers: string[];
    expectedServiceCategories: string[];
    [key: string]: unknown;
  },
  options: { model: string; generate?: Generator; now?: () => number }
) => {
  const now = options.now ?? Date.now;
  const started = now();
  try {
    const result = await (options.generate ?? (generateText as unknown as Generator))({
      model: options.model,
      output: Output.object({ schema: interpretationOutputSchema }),
      system: INTERPRETATION_SYSTEM_PROMPT,
      prompt: JSON.stringify(input),
      temperature: 0,
      maxRetries: 0,
      timeout: 30_000,
      telemetry: { recordInputs: false, recordOutputs: false },
    });
    const output = validateInterpretationOutput(
      result.output,
      new Set(input.allowedNumbers),
      input.expectedServiceCategories
    );
    return {
      output,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      durationMs: now() - started,
    };
  } catch (error) {
    if (error instanceof InterpretationGenerationError) {
      throw error;
    }
    if (typeof error === "object" && error && "statusCode" in error && error.statusCode === 429) {
      throw new InterpretationGenerationError("RATE_LIMITED");
    }
    if (error instanceof Error && timeoutPattern.test(`${error.name} ${error.message}`)) {
      throw new InterpretationGenerationError("TIMEOUT");
    }
    if (error instanceof Error && invalidOutputPattern.test(`${error.name} ${error.message}`)) {
      throw new InterpretationGenerationError("INVALID_OUTPUT");
    }
    throw new InterpretationGenerationError("GATEWAY_ERROR");
  }
};

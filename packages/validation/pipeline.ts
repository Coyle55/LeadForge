import { z } from "zod";

const CURRENCY_PATTERN = /^\d+(\.\d{1,2})?$/;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_VALUE_CENTS = 2_147_483_647n;

const emptyStringToNull = (value: unknown) => {
  if (value === undefined) {
    return null;
  }

  return typeof value === "string" && value.trim() === "" ? null : value;
};

const currencyCentsSchema = z
  .string()
  .trim()
  .regex(CURRENCY_PATTERN, "Enter a currency value with at most two decimals")
  .transform((value, context) => {
    const [dollars, decimal = ""] = value.split(".");
    const cents = BigInt(dollars) * 100n + BigInt(decimal.padEnd(2, "0"));

    if (cents <= 0n || cents > MAX_VALUE_CENTS) {
      context.addIssue({
        code: "custom",
        message: "Value must be a positive 32-bit integer number of cents",
      });
      return z.NEVER;
    }

    return Number(cents);
  });

const dateOnlySchema = z
  .string()
  .trim()
  .regex(DATE_ONLY_PATTERN, "Enter a valid date")
  .transform((value, context) => {
    const date = new Date(`${value}T12:00:00.000Z`);

    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value
    ) {
      context.addIssue({ code: "custom", message: "Enter a valid date" });
      return z.NEVER;
    }

    return date;
  });

const nullableCurrencyCentsSchema = z.preprocess(
  emptyStringToNull,
  currencyCentsSchema.nullable()
);

const nullableDateOnlySchema = z.preprocess(
  emptyStringToNull,
  dateOnlySchema.nullable()
);

const nullableLossReasonSchema = z.preprocess(
  emptyStringToNull,
  z.string().trim().max(500).nullable()
);

const optionalTransitionFields = {
  value: nullableCurrencyCentsSchema,
  actualCloseDate: nullableDateOnlySchema,
  lossReason: nullableLossReasonSchema,
};

const pipelineTransitionInputSchema = z.discriminatedUnion("destination", [
  z.object({ destination: z.literal("NEW"), ...optionalTransitionFields }),
  z.object({
    destination: z.literal("CONTACTED"),
    ...optionalTransitionFields,
  }),
  z.object({
    destination: z.literal("INTERESTED"),
    ...optionalTransitionFields,
  }),
  z.object({ destination: z.literal("PROPOSAL"), ...optionalTransitionFields }),
  z.object({
    destination: z.literal("WON"),
    value: currencyCentsSchema,
    actualCloseDate: dateOnlySchema,
    lossReason: nullableLossReasonSchema,
  }),
  z.object({
    destination: z.literal("LOST"),
    ...optionalTransitionFields,
    lossReason: z.string().trim().min(1).max(500),
  }),
]);

export const pipelineTransitionSchema = pipelineTransitionInputSchema.transform(
  ({ destination, value, actualCloseDate, lossReason }) => ({
    destination,
    valueCents: value,
    actualCloseDate,
    lossReason,
  })
);

export const dealEditSchema = z
  .object({
    value: nullableCurrencyCentsSchema,
    expectedCloseDate: nullableDateOnlySchema,
  })
  .transform(({ value, expectedCloseDate }) => ({
    valueCents: value,
    expectedCloseDate,
  }));

export type PipelineTransitionInput = z.infer<typeof pipelineTransitionSchema>;
export type DealEditInput = z.infer<typeof dealEditSchema>;

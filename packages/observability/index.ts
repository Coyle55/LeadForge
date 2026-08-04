import "server-only";

type LogFields = Record<string, unknown>;

const serializeError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return error;
  }

  return { name: error.name, message: error.message, stack: error.stack };
};

const write = (
  level: "info" | "error",
  event: string,
  fields: LogFields = {}
) => {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields,
    ...(fields.error ? { error: serializeError(fields.error) } : {}),
  };

  const output = JSON.stringify(record);
  if (level === "error") {
    console.error(output);
    return;
  }
  console.info(output);
};

export const logger = {
  info: (event: string, fields?: LogFields) => write("info", event, fields),
  error: (event: string, fields?: LogFields) => write("error", event, fields),
};

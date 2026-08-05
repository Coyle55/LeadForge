export const APP_TIME_ZONE = "America/New_York";

interface LocalDateTimeParts {
  day: number;
  hour: number;
  millisecond: number;
  minute: number;
  month: number;
  second: number;
  year: number;
}

const zonedDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  calendar: "iso8601",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  month: "2-digit",
  numberingSystem: "latn",
  second: "2-digit",
  timeZone: APP_TIME_ZONE,
  year: "numeric",
});

const getZonedParts = (value: Date): LocalDateTimeParts => {
  if (Number.isNaN(value.getTime())) {
    throw new RangeError("Invalid date");
  }

  const parts = Object.fromEntries(
    zonedDateTimeFormatter
      .formatToParts(value)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value: partValue }) => [type, Number(partValue)])
  );

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
    millisecond: value.getUTCMilliseconds(),
  } as LocalDateTimeParts;
};

const getUtcTimestamp = (parts: LocalDateTimeParts): number => {
  const value = new Date(0);
  value.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  value.setUTCHours(parts.hour, parts.minute, parts.second, parts.millisecond);
  return value.getTime();
};

const getOffsetAt = (value: Date): number => {
  const zoned = getZonedParts(value);
  const instantWithoutMilliseconds =
    value.getTime() - value.getUTCMilliseconds();
  return (
    getUtcTimestamp({ ...zoned, millisecond: 0 }) - instantWithoutMilliseconds
  );
};

const matchesLocalDateTime = (
  actual: LocalDateTimeParts,
  expected: LocalDateTimeParts
) =>
  actual.year === expected.year &&
  actual.month === expected.month &&
  actual.day === expected.day &&
  actual.hour === expected.hour &&
  actual.minute === expected.minute &&
  actual.second === expected.second &&
  actual.millisecond === expected.millisecond;

const resolveLocalDateTime = (parts: LocalDateTimeParts): Date => {
  const wallTimeAsUtc = getUtcTimestamp(parts);
  const probeDistance = 24 * 60 * 60 * 1000;
  const offsets = new Set(
    [-probeDistance, 0, probeDistance].map((distance) =>
      getOffsetAt(new Date(wallTimeAsUtc + distance))
    )
  );

  const candidates = [...offsets]
    .map((offset) => new Date(wallTimeAsUtc - offset))
    .filter((candidate) =>
      matchesLocalDateTime(getZonedParts(candidate), parts)
    )
    .sort((left, right) => left.getTime() - right.getTime());

  const resolved = candidates[0];
  if (!resolved) {
    throw new RangeError("Local time does not exist in America/New_York");
  }

  return resolved;
};

const addLocalDays = (
  parts: Pick<LocalDateTimeParts, "year" | "month" | "day">,
  days: number
) => {
  const value = new Date(0);
  value.setUTCFullYear(parts.year, parts.month - 1, parts.day + days);
  value.setUTCHours(0, 0, 0, 0);
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  };
};

const atMidnight = (
  date: Pick<LocalDateTimeParts, "year" | "month" | "day">
): LocalDateTimeParts => ({
  ...date,
  hour: 0,
  minute: 0,
  second: 0,
  millisecond: 0,
});

export const getTaskDayBounds = (now: Date): { start: Date; end: Date } => {
  const today = getZonedParts(now);
  const tomorrow = addLocalDays(today, 1);

  return {
    start: resolveLocalDateTime(atMidnight(today)),
    end: resolveLocalDateTime(atMidnight(tomorrow)),
  };
};

const localInputPattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/u;

const parseLocalInput = (value: string): LocalDateTimeParts => {
  const match = localInputPattern.exec(value);
  if (!match) {
    throw new RangeError("Invalid datetime-local value");
  }

  const [, year, month, day, hour, minute, second = "0", fraction = "0"] =
    match;
  const parts: LocalDateTimeParts = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
    millisecond: Number(fraction.padEnd(3, "0")),
  };

  const normalized = new Date(getUtcTimestamp(parts));
  if (
    normalized.getUTCFullYear() !== parts.year ||
    normalized.getUTCMonth() + 1 !== parts.month ||
    normalized.getUTCDate() !== parts.day ||
    normalized.getUTCHours() !== parts.hour ||
    normalized.getUTCMinutes() !== parts.minute ||
    normalized.getUTCSeconds() !== parts.second ||
    normalized.getUTCMilliseconds() !== parts.millisecond
  ) {
    throw new RangeError("Invalid datetime-local value");
  }

  return parts;
};

export const zonedLocalInputToIso = (value: string): string =>
  resolveLocalDateTime(parseLocalInput(value)).toISOString();

const pad = (value: number) => String(value).padStart(2, "0");

export const dateToZonedLocalInput = (value: Date): string => {
  const parts = getZonedParts(value);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(
    parts.hour
  )}:${pad(parts.minute)}`;
};

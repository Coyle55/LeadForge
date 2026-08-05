export interface MonthBucket {
  end: Date;
  key: string;
  label: string;
  start: Date;
}

const MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

export const getTrailingMonths = (
  now: Date,
  count: number
): MonthBucket[] => {
  const months: MonthBucket[] = [];
  const currentMonthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);

  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const start = new Date(
      Date.UTC(1970, 0, 1) +
        (currentMonthStart - Date.UTC(1970, 0, 1))
    );
    start.setUTCMonth(start.getUTCMonth() - offset);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);

    months.push({
      start,
      end,
      key: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`,
      label: MONTH_LABEL_FORMATTER.format(start),
    });
  }

  return months;
};

export const sumByMonth = <T>(
  months: MonthBucket[],
  items: T[],
  getDate: (item: T) => Date,
  getValue: (item: T) => number = () => 1
): number[] => {
  const totals = new Array(months.length).fill(0);
  for (const item of items) {
    const date = getDate(item);
    const index = months.findIndex(
      (month) => date >= month.start && date < month.end
    );
    if (index !== -1) {
      totals[index] += getValue(item);
    }
  }
  return totals;
};

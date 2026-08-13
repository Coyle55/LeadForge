"use client";

import type { RevenuePoint } from "./queries";
import { TrendChart, type TrendTooltipFormatter } from "./trend-chart";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});

const formatRevenueTooltip: TrendTooltipFormatter = (value, name, item) => (
  <div className="flex w-full flex-1 items-center justify-between gap-2 leading-none">
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
        style={{ backgroundColor: item.color }}
      />
      {name}
    </span>
    <span className="font-medium font-mono text-foreground tabular-nums">
      {currencyFormatter.format(Number(value))}
    </span>
  </div>
);

export const RevenueTrendChart = ({
  data,
  emptyMessage,
}: {
  data: RevenuePoint[];
  emptyMessage: string;
}) => (
  <TrendChart
    data={data.map((point) => ({
      ...point,
      dollars: point.valueCents / 100,
    }))}
    emptyMessage={emptyMessage}
    series={[
      { color: "var(--chart-1)", dataKey: "dollars", label: "Won revenue" },
    ]}
    tooltipFormatter={formatRevenueTooltip}
  />
);

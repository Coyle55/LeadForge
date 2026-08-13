"use client";

import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@repo/design-system/components/ui/chart";
import type { ComponentProps } from "react";
import { CartesianGrid, Line, LineChart, XAxis } from "recharts";

import { ReportsEmptyState } from "./empty-state";

export interface TrendSeries {
  color: string;
  dataKey: string;
  label: string;
}

// Mirrors ChartTooltipContent's `formatter` prop so chart-specific instances
// (e.g. the revenue trend) can render currency-formatted tooltip values
// without hardcoding that formatting into this generic component.
export type TrendTooltipFormatter = ComponentProps<
  typeof ChartTooltipContent
>["formatter"];

export const hasTrendData = <T extends object>(
  data: T[],
  dataKeys: string[]
): boolean =>
  data.some((point) =>
    dataKeys.some((key) => Number((point as Record<string, unknown>)[key]) > 0)
  );

export const TrendChart = <T extends object>({
  data,
  emptyMessage,
  series,
  tooltipFormatter,
}: {
  data: T[];
  emptyMessage: string;
  series: TrendSeries[];
  tooltipFormatter?: TrendTooltipFormatter;
}) => {
  if (
    !hasTrendData(
      data,
      series.map((line) => line.dataKey)
    )
  ) {
    return <ReportsEmptyState message={emptyMessage} />;
  }

  const config: ChartConfig = Object.fromEntries(
    series.map((line) => [
      line.dataKey,
      { label: line.label, color: line.color },
    ])
  );

  return (
    <ChartContainer className="h-64 w-full" config={config}>
      <LineChart data={data}>
        <CartesianGrid vertical={false} />
        <XAxis
          axisLine={false}
          dataKey="label"
          tickLine={false}
          tickMargin={8}
        />
        <ChartTooltip
          content={<ChartTooltipContent formatter={tooltipFormatter} />}
        />
        <ChartLegend content={<ChartLegendContent />} />
        {series.map((line) => (
          <Line
            dataKey={line.dataKey}
            dot={false}
            key={line.dataKey}
            stroke={`var(--color-${line.dataKey})`}
            type="monotone"
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
};

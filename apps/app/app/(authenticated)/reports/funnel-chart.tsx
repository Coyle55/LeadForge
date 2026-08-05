"use client";

import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@repo/design-system/components/ui/chart";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import { ReportsEmptyState } from "./empty-state";
import type { FunnelStageCount, StageConversion } from "./queries";

const STAGE_LABELS: Record<string, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  INTERESTED: "Interested",
  PROPOSAL: "Proposal",
};

const CHART_CONFIG: ChartConfig = {
  count: { label: "Active prospects", color: "var(--chart-1)" },
};

export const hasFunnelData = (
  funnel: FunnelStageCount[],
  terminalTotals: { lost: number; won: number }
): boolean =>
  funnel.some((stage) => stage.count > 0) ||
  terminalTotals.won > 0 ||
  terminalTotals.lost > 0;

export const FunnelChart = ({
  conversionRates,
  funnel,
  terminalTotals,
}: {
  conversionRates: StageConversion[];
  funnel: FunnelStageCount[];
  terminalTotals: { lost: number; won: number };
}) => {
  if (!hasFunnelData(funnel, terminalTotals)) {
    return (
      <ReportsEmptyState message="No prospects yet — the funnel fills in once you add some." />
    );
  }

  const data = funnel.map((stage) => ({
    label: STAGE_LABELS[stage.stage],
    count: stage.count,
  }));

  return (
    <div className="space-y-4">
      <ChartContainer className="h-64 w-full" config={CHART_CONFIG}>
        <BarChart data={data}>
          <CartesianGrid vertical={false} />
          <XAxis
            axisLine={false}
            dataKey="label"
            tickLine={false}
            tickMargin={8}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="count" fill="var(--color-count)" radius={4} />
        </BarChart>
      </ChartContainer>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {conversionRates.map((conversion) => (
          <div
            className="rounded-lg border p-3"
            key={`${conversion.from}-${conversion.to}`}
          >
            <dt className="text-muted-foreground text-xs">
              {STAGE_LABELS[conversion.from]} → {STAGE_LABELS[conversion.to]}
            </dt>
            <dd className="font-mono font-semibold text-lg tabular-nums">
              {conversion.rate === null
                ? "—"
                : `${Math.round(conversion.rate * 100)}%`}
            </dd>
          </div>
        ))}
        <div className="rounded-lg border p-3">
          <dt className="text-muted-foreground text-xs">Won</dt>
          <dd className="font-mono font-semibold text-lg tabular-nums">
            {terminalTotals.won}
          </dd>
        </div>
        <div className="rounded-lg border p-3">
          <dt className="text-muted-foreground text-xs">Lost</dt>
          <dd className="font-mono font-semibold text-lg tabular-nums">
            {terminalTotals.lost}
          </dd>
        </div>
      </dl>
    </div>
  );
};

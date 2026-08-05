import { ensureCurrentUser } from "@repo/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/ui/card";

import { FunnelChart } from "./funnel-chart";
import { getReportsMetrics } from "./queries";
import { TrendChart } from "./trend-chart";

const ReportsPage = async () => {
  const user = await ensureCurrentUser();
  const metrics = await getReportsMetrics(user.id);

  return (
    <div className="space-y-6">
      <div className="border-b pb-5">
        <p className="font-medium text-emerald-700 text-xs uppercase tracking-[0.22em] dark:text-emerald-400">
          Reporting
        </p>
        <h1 className="mt-1 font-semibold text-3xl tracking-tight">Reports</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Pipeline flow, revenue, and activity over the trailing 12 months.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pipeline</CardTitle>
          <CardDescription>
            Active prospects by stage and stage-to-stage conversion.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FunnelChart
            conversionRates={metrics.conversionRates}
            funnel={metrics.funnel}
            terminalTotals={metrics.terminalTotals}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Revenue</CardTitle>
          <CardDescription>
            Win rate and won revenue over the trailing 12 months.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="font-mono font-semibold text-3xl tabular-nums">
            {metrics.winRate === null
              ? "—"
              : `${Math.round(metrics.winRate * 100)}%`}
          </p>
          <TrendChart
            data={metrics.revenueTrend.map((point) => ({
              ...point,
              valueCents: point.valueCents / 100,
            }))}
            emptyMessage="No closed deals yet in the last 12 months."
            series={[
              {
                color: "var(--chart-1)",
                dataKey: "valueCents",
                label: "Won revenue",
              },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
          <CardDescription>
            Follow-through over the trailing 12 months.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <TrendChart
            data={metrics.taskTrend}
            emptyMessage="No tasks yet in the last 12 months."
            series={[
              { color: "var(--chart-1)", dataKey: "created", label: "Created" },
              {
                color: "var(--chart-2)",
                dataKey: "completed",
                label: "Completed",
              },
            ]}
          />
          <TrendChart
            data={metrics.activityTrend}
            emptyMessage="No audits or outreach drafts yet in the last 12 months."
            series={[
              { color: "var(--chart-1)", dataKey: "audits", label: "Audits" },
              {
                color: "var(--chart-2)",
                dataKey: "outreachDrafts",
                label: "Outreach drafts",
              },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
};

export default ReportsPage;

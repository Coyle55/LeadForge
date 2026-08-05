import { ensureCurrentUser } from "@repo/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/ui/card";
import {
  ArrowUpRight,
  BriefcaseBusiness,
  CalendarClock,
  CircleDollarSign,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { getDashboardMetrics } from "./dashboard/queries";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});

const Dashboard = async () => {
  const user = await ensureCurrentUser();
  const metrics = await getDashboardMetrics(user.id);
  const cards = [
    {
      description: "Open follow-ups already past due",
      href: "/tasks?status=OVERDUE",
      icon: TriangleAlert,
      label: "Overdue",
      tone: "text-rose-600",
      value: String(metrics.overdueTaskCount),
    },
    {
      description: "Follow-ups due on the New York day",
      href: "/tasks?status=DUE_TODAY",
      icon: CalendarClock,
      label: "Due today",
      tone: "text-sky-600",
      value: String(metrics.dueTodayTaskCount),
    },
    {
      description: "Unarchived prospects across the pipeline",
      href: "/pipeline",
      icon: BriefcaseBusiness,
      label: "Active prospects",
      tone: "text-amber-600",
      value: String(metrics.activeProspectCount),
    },
    {
      description: "Interested and proposal-stage Deal value",
      href: "/pipeline",
      icon: CircleDollarSign,
      label: "Open Deal value",
      tone: "text-emerald-600",
      value: currencyFormatter.format(metrics.openDealValueCents / 100),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-medium text-emerald-700 text-xs uppercase tracking-[0.22em] dark:text-emerald-400">
            Operating overview
          </p>
          <h1 className="mt-1 font-semibold text-3xl tracking-tight">
            Dashboard
          </h1>
          <p className="mt-1 text-muted-foreground text-sm">
            The work that needs attention now.
          </p>
        </div>
        <div className="max-w-full rounded-lg border bg-card px-3.5 py-2.5 text-sm shadow-xs">
          <p className="truncate font-medium">
            {user.displayName ?? user.email}
          </p>
          {user.displayName ? (
            <p className="truncate text-muted-foreground text-xs">
              {user.email}
            </p>
          ) : null}
        </div>
      </div>

      <section
        aria-label="Operational metrics"
        className="grid gap-4 sm:grid-cols-2"
      >
        {cards.map((metric) => {
          const Icon = metric.icon;
          return (
            <Link
              className="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              href={metric.href}
              key={metric.label}
            >
              <Card className="h-full gap-5 py-5 transition-[border-color,box-shadow,transform] group-hover:-translate-y-0.5 group-hover:border-foreground/20 group-hover:shadow-md">
                <CardHeader className="px-5">
                  <div className="flex items-start justify-between gap-4">
                    <span className="flex size-9 items-center justify-center rounded-lg border bg-muted/30">
                      <Icon
                        aria-hidden="true"
                        className={`size-4 ${metric.tone}`}
                      />
                    </span>
                    <ArrowUpRight
                      aria-hidden="true"
                      className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                    />
                  </div>
                  <CardTitle className="mt-3 text-sm">{metric.label}</CardTitle>
                  <CardDescription>{metric.description}</CardDescription>
                </CardHeader>
                <CardContent className="px-5">
                  <p className="font-mono font-semibold text-3xl tabular-nums tracking-tight">
                    {metric.value}
                  </p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </section>
    </div>
  );
};

export default Dashboard;

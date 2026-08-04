import { auth } from "@repo/auth/server";
import { Badge } from "@repo/design-system/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/ui/card";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getOpportunityDetail } from "../queries";

const categoryLabels = {
  accessibility: "Accessibility",
  trust: "Trust",
  seo: "SEO",
  technical: "Technical",
  performance: "Performance",
} as const;

const OpportunityDetailPage = async ({
  params,
}: {
  params: Promise<{ id: string }>;
}) => {
  const [{ id }, { userId }] = await Promise.all([params, auth()]);
  if (!userId) {
    return null;
  }
  const analysis = await getOpportunityDetail(userId, id);
  if (!analysis) {
    notFound();
  }

  if (analysis.status !== "COMPLETED") {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <p className="font-medium text-emerald-600 text-xs uppercase tracking-[0.22em]">
            Opportunity analysis
          </p>
          <h1 className="font-semibold text-3xl tracking-tight">
            Analysis unavailable
          </h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>
              {analysis.status === "RUNNING"
                ? "Analysis in progress"
                : "Analysis could not complete"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              {analysis.failureMessage ??
                "The assessment is still being generated."}
            </p>
          </CardContent>
        </Card>
        <Link
          className="text-sm underline underline-offset-4"
          href={`/audits/${analysis.auditId}`}
        >
          Return to source audit
        </Link>
      </div>
    );
  }

  const scores = analysis.categoryScores as Record<
    keyof typeof categoryLabels,
    number
  >;
  const checkLabels = new Map(
    analysis.audit?.checks.map((check) => [check.key, check.label]) ?? []
  );
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <section className="grid gap-6 border-b pb-8 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <p className="font-medium text-emerald-600 text-xs uppercase tracking-[0.22em]">
            Opportunity analysis
          </p>
          <h1 className="font-semibold text-3xl tracking-tight">
            {analysis.prospect?.businessName ?? "Prospect"}
          </h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            {analysis.executiveSummary}
          </p>
        </div>
        <div className="rounded-full border-2 border-emerald-500/60 bg-emerald-500/5 px-8 py-6 text-center">
          <p className="font-semibold text-5xl tabular-nums">
            {analysis.overallScore}
          </p>
          <p className="text-muted-foreground text-xs uppercase tracking-wider">
            Opportunity / 100
          </p>
        </div>
      </section>
      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {Object.entries(categoryLabels).map(([key, label]) => (
          <div className="rounded-lg border bg-card p-4" key={key}>
            <p className="text-muted-foreground text-xs">{label}</p>
            <p className="mt-1 font-semibold text-2xl tabular-nums">
              {scores[key as keyof typeof scores]}
            </p>
          </div>
        ))}
      </section>
      <Card>
        <CardHeader>
          <CardTitle>Why this is an opportunity</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground leading-7">
            {analysis.overallRationale}
          </p>
        </CardContent>
      </Card>
      <section className="space-y-4">
        <div>
          <p className="font-medium text-emerald-600 text-xs uppercase tracking-[0.22em]">
            Recommended approach
          </p>
          <h2 className="font-semibold text-2xl tracking-tight">
            Prioritized improvements
          </h2>
        </div>
        {analysis.recommendations.map((recommendation, index) => {
          const keys = recommendation.auditCheckKeys as string[];
          return (
            <Card key={recommendation.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex gap-4">
                    <span className="text-muted-foreground text-sm tabular-nums">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <CardTitle>{recommendation.title}</CardTitle>
                  </div>
                  <div className="flex gap-2">
                    <Badge variant="outline">
                      {recommendation.impact.toLowerCase()} impact
                    </Badge>
                    <Badge variant="outline">
                      {recommendation.effort.toLowerCase()} effort
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 pl-14">
                <p className="text-muted-foreground">
                  {recommendation.rationale}
                </p>
                <div className="border-emerald-500 border-l-2 pl-4">
                  <p className="font-medium text-sm">Suggested action</p>
                  <p className="mt-1 text-sm">{recommendation.action}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {keys.map((key) => (
                    <Link
                      className="rounded-full border px-2.5 py-1 text-muted-foreground text-xs hover:text-foreground"
                      href={`/audits/${analysis.auditId}#${key}`}
                      key={key}
                    >
                      {checkLabels.get(key) ?? key}
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </section>
      <footer className="flex flex-wrap gap-x-5 gap-y-2 border-t pt-5 text-muted-foreground text-xs">
        <span>Model: {analysis.model}</span>
        <span>Prompt: {analysis.promptVersion}</span>
        <span>{analysis.durationMs ?? "—"} ms</span>
        <Link
          className="underline underline-offset-4"
          href={`/audits/${analysis.auditId}`}
        >
          Source audit
        </Link>
      </footer>
    </div>
  );
};

export default OpportunityDetailPage;

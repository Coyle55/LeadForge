import { auth } from "@repo/auth/server";
import { Badge } from "@repo/design-system/components/ui/badge";
import { Button } from "@repo/design-system/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/ui/card";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AnalyzeButton } from "../../opportunities/analyze-button";
import { getLatestAuditOpportunity } from "../../opportunities/queries";
import { getAuditDetail } from "../queries";
import { RunAuditButton } from "../run-audit-button";

const order = { FAIL: 0, WARNING: 1, PASS: 2 } as const;
const categories = [
  "ACCESSIBILITY",
  "TRUST",
  "BOOKING",
  "SEO",
  "TECHNICAL",
  "PERFORMANCE",
] as const;

const AuditDetailPage = async ({
  params,
}: {
  params: Promise<{ id: string }>;
}) => {
  const [{ id }, { userId }] = await Promise.all([params, auth()]);
  if (!userId) {
    return null;
  }
  const audit = await getAuditDetail(userId, id);
  if (!audit) {
    notFound();
  }
  const latestOpportunity = await getLatestAuditOpportunity(userId, id);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="font-medium text-emerald-600 text-xs uppercase tracking-[0.22em]">
            Website audit
          </p>
          <h1 className="font-semibold text-3xl tracking-tight">
            {audit.prospect?.businessName ??
              new URL(audit.requestedUrl).hostname}
          </h1>
          <p className="text-muted-foreground text-sm">
            {audit.pagesAudited}/{audit.pagesAttempted} pages ·{" "}
            {audit.durationMs ?? "—"} ms
          </p>
        </div>
        <Badge variant={audit.status === "FAILED" ? "destructive" : "outline"}>
          {audit.status.toLowerCase()}
        </Badge>
      </div>
      {audit.status === "FAILED" ? (
        <Card>
          <CardHeader>
            <CardTitle>Audit could not complete</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">{audit.failureMessage}</p>
          </CardContent>
        </Card>
      ) : (
        categories.map((category) => {
          const checks = audit.checks
            .filter((check) => check.category === category)
            .sort((a, b) => order[a.status] - order[b.status]);
          return checks.length ? (
            <Card key={category}>
              <CardHeader>
                <CardTitle className="capitalize">
                  {category.toLowerCase()}
                </CardTitle>
              </CardHeader>
              <CardContent className="divide-y">
                {checks.map((check) => (
                  <div
                    className="grid gap-2 py-4 md:grid-cols-[auto_1fr]"
                    id={check.key}
                    key={check.id}
                  >
                    <Badge
                      variant={
                        check.status === "FAIL" ? "destructive" : "outline"
                      }
                    >
                      {check.status.toLowerCase()}
                    </Badge>
                    <div>
                      <p className="font-medium">{check.label}</p>
                      <p className="text-muted-foreground text-sm">
                        {check.summary}
                      </p>
                      <dl className="mt-2 flex flex-wrap gap-3 text-xs">
                        {Object.entries(
                          check.evidence as Record<string, unknown>
                        ).map(([key, value]) => (
                          <div key={key}>
                            <dt className="text-muted-foreground">{key}</dt>
                            <dd>{String(value)}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null;
        })
      )}
      <div className="flex flex-wrap items-start gap-3 border-t pt-6">
        {audit.prospect ? (
          <RunAuditButton prospectId={audit.prospect.id} rerun />
        ) : null}
        {audit.status === "COMPLETED" ? (
          <AnalyzeButton auditId={audit.id} />
        ) : null}
        {latestOpportunity ? (
          <Button asChild variant="outline">
            <Link href={`/opportunities/${latestOpportunity.id}`}>
              View latest analysis
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
};
export default AuditDetailPage;

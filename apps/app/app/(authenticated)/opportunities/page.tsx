import { auth } from "@repo/auth/server";
import { Badge } from "@repo/design-system/components/ui/badge";
import { Button } from "@repo/design-system/components/ui/button";
import Link from "next/link";
import { getOpportunities, parseOpportunityListParams } from "./queries";

const OpportunitiesPage = async ({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const { userId } = await auth();
  if (!userId) {
    return null;
  }
  const input = parseOpportunityListParams(await searchParams);
  const { analyses, total, pageCount } = await getOpportunities({
    userId,
    ...input,
  });
  const href = (page: number) =>
    `/opportunities?status=${input.status}&page=${page}`;

  return (
    <div className="space-y-7">
      <div className="border-emerald-500 border-l-2 pl-5">
        <p className="font-medium text-emerald-600 text-xs uppercase tracking-[0.22em]">
          Sales intelligence
        </p>
        <h1 className="font-semibold text-3xl tracking-tight">Opportunities</h1>
        <p className="mt-1 text-muted-foreground">
          {total} {input.status.toLowerCase()} AI assessment
          {total === 1 ? "" : "s"}
        </p>
      </div>
      <form className="flex gap-3">
        <select
          className="rounded-md border bg-background px-3 py-2 text-sm"
          defaultValue={input.status}
          name="status"
        >
          <option value="COMPLETED">Completed</option>
          <option value="FAILED">Failed</option>
        </select>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>
      {analyses.length ? (
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="divide-y">
            {analyses.map((analysis) => (
              <Link
                className="grid items-center gap-3 p-4 transition-colors hover:bg-muted/40 md:grid-cols-[1fr_auto_auto]"
                href={`/opportunities/${analysis.id}`}
                key={analysis.id}
              >
                <div>
                  <p className="font-medium">
                    {analysis.prospect?.businessName ?? "Unknown prospect"}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {analysis.prospect?.websiteUrl
                      ? new URL(analysis.prospect.websiteUrl).hostname
                      : analysis.model}
                  </p>
                </div>
                {analysis.status === "COMPLETED" ? (
                  <div className="text-right">
                    <span className="font-semibold text-2xl tabular-nums">
                      {analysis.overallScore}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {" "}
                      / 100
                    </span>
                  </div>
                ) : (
                  <Badge variant="destructive">failed</Badge>
                )}
                <time className="text-muted-foreground text-xs">
                  {analysis.createdAt.toLocaleDateString()}
                </time>
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-14 text-center">
          <h2 className="font-medium text-lg">
            No {input.status.toLowerCase()} analyses
          </h2>
          <p className="mt-2 text-muted-foreground text-sm">
            Open a completed audit to generate an opportunity assessment.
          </p>
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button
          asChild={input.page > 1}
          disabled={input.page <= 1}
          variant="outline"
        >
          {input.page > 1 ? (
            <Link href={href(input.page - 1)}>Previous</Link>
          ) : (
            <span>Previous</span>
          )}
        </Button>
        <span className="px-3 py-2 text-sm">
          Page {input.page} of {Math.max(1, pageCount)}
        </span>
        <Button
          asChild={input.page < pageCount}
          disabled={input.page >= pageCount}
          variant="outline"
        >
          {input.page < pageCount ? (
            <Link href={href(input.page + 1)}>Next</Link>
          ) : (
            <span>Next</span>
          )}
        </Button>
      </div>
    </div>
  );
};

export default OpportunitiesPage;

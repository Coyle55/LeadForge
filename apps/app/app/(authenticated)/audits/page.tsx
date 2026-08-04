import { auth } from "@repo/auth/server";
import { Badge } from "@repo/design-system/components/ui/badge";
import { Button } from "@repo/design-system/components/ui/button";
import Link from "next/link";
import { getAudits, parseAuditListParams } from "./queries";

const AuditsPage = async ({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const { userId } = await auth();
  if (!userId) {
    return null;
  }
  const input = parseAuditListParams(await searchParams);
  const { audits, total, pageCount } = await getAudits({ userId, ...input });
  const href = (page: number) => `/audits?status=${input.status}&page=${page}`;
  return (
    <div className="space-y-6">
      <div>
        <p className="font-medium text-emerald-600 text-xs uppercase tracking-[0.22em]">
          Website intelligence
        </p>
        <h1 className="font-semibold text-3xl tracking-tight">Audits</h1>
        <p className="text-muted-foreground">
          {total} recorded run{total === 1 ? "" : "s"}
        </p>
      </div>
      <form className="flex gap-3">
        <select
          className="rounded-md border bg-background px-3 py-2 text-sm"
          defaultValue={input.status}
          name="status"
        >
          <option value="ALL">All</option>
          <option value="COMPLETED">Completed</option>
          <option value="FAILED">Failed</option>
        </select>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>
      {audits.length ? (
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="divide-y">
            {audits.map((audit) => (
              <Link
                className="grid gap-2 p-4 transition-colors hover:bg-muted/40 md:grid-cols-[1fr_1fr_auto_auto]"
                href={`/audits/${audit.id}`}
                key={audit.id}
              >
                <div>
                  <p className="font-medium">{audit.prospectName}</p>
                  <p className="text-muted-foreground text-xs">
                    {new URL(audit.requestedUrl).hostname}
                  </p>
                </div>
                <p className="text-muted-foreground text-sm">
                  {audit.pagesAudited}/{audit.pagesAttempted} pages ·{" "}
                  {audit.durationMs ?? "—"} ms
                </p>
                <Badge
                  variant={
                    audit.status === "FAILED" ? "destructive" : "outline"
                  }
                >
                  {audit.status.toLowerCase()}
                </Badge>
                <time className="text-muted-foreground text-xs">
                  {audit.createdAt.toLocaleDateString()}
                </time>
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-14 text-center">
          <h2 className="font-medium text-lg">No audit runs yet</h2>
          <p className="mt-2 text-muted-foreground text-sm">
            Open a prospect with a website to run the first audit.
          </p>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button asChild disabled={input.page <= 1} variant="outline">
          <Link href={href(Math.max(1, input.page - 1))}>Previous</Link>
        </Button>
        <span className="px-3 py-2 text-sm">
          Page {input.page} of {Math.max(1, pageCount)}
        </span>
        <Button asChild disabled={input.page >= pageCount} variant="outline">
          <Link href={href(input.page + 1)}>Next</Link>
        </Button>
      </div>
    </div>
  );
};
export default AuditsPage;

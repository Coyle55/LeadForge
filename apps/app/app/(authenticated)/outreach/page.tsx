import { auth } from "@repo/auth/server";
import { Badge } from "@repo/design-system/components/ui/badge";
import { Button } from "@repo/design-system/components/ui/button";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getOutreachDrafts, parseOutreachListParams } from "./queries";

const OutreachPage = async ({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const { userId } = await auth();
  if (!userId) {
    return null;
  }

  const input = parseOutreachListParams(await searchParams);
  const { drafts, pageCount, total } = await getOutreachDrafts({
    userId,
    ...input,
  });
  const href = (page: number) =>
    `/outreach?status=${input.status}&page=${page}`;
  const maxPage = Math.max(1, pageCount);
  if (input.page > maxPage) {
    redirect(href(maxPage));
  }

  return (
    <div className="space-y-7">
      <div className="border-emerald-500 border-l-2 pl-5">
        <p className="font-medium text-emerald-600 text-xs uppercase tracking-[0.22em]">
          Outreach workspace
        </p>
        <h1 className="font-semibold text-3xl tracking-tight">Draft history</h1>
        <p className="mt-1 text-muted-foreground">
          {total} {input.status.toLowerCase()} draft{total === 1 ? "" : "s"}
        </p>
      </div>

      <form className="flex flex-wrap gap-3">
        <label className="sr-only" htmlFor="outreach-status">
          Draft status
        </label>
        <select
          className="rounded-md border bg-background px-3 py-2 text-sm"
          defaultValue={input.status}
          id="outreach-status"
          name="status"
        >
          <option value="COMPLETED">Completed</option>
          <option value="FAILED">Failed</option>
        </select>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>

      {drafts.length ? (
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="divide-y">
            {drafts.map((draft) => (
              <Link
                className="grid gap-3 p-4 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                href={`/outreach/${draft.id}`}
                key={draft.id}
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {draft.recipientName} · {draft.prospectName}
                  </p>
                  <p className="mt-1 truncate text-muted-foreground text-sm">
                    {draft.recommendationTitle}
                  </p>
                  <p className="mt-1 text-muted-foreground text-xs">
                    {draft.websiteHostname}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-4 md:justify-end">
                  <Badge
                    className={
                      draft.status === "COMPLETED"
                        ? "border-emerald-600/30 text-emerald-700"
                        : undefined
                    }
                    variant={
                      draft.status === "FAILED" ? "destructive" : "outline"
                    }
                  >
                    {draft.status.toLowerCase()}
                  </Badge>
                  <time
                    className="text-muted-foreground text-xs tabular-nums"
                    dateTime={draft.createdAt.toISOString()}
                  >
                    {draft.createdAt.toLocaleString()}
                  </time>
                </div>
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-10 text-center sm:p-14">
          <h2 className="font-medium text-lg">
            No {input.status.toLowerCase()} drafts
          </h2>
          <p className="mx-auto mt-2 max-w-md text-muted-foreground text-sm">
            Open a completed opportunity and choose a grounded recommendation to
            prepare outreach.
          </p>
          <Button asChild className="mt-5" variant="outline">
            <Link href="/opportunities">Browse opportunities</Link>
          </Button>
        </div>
      )}

      <nav
        aria-label="Outreach history pagination"
        className="flex flex-wrap items-center justify-end gap-2"
      >
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
          Page {input.page} of {maxPage}
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
      </nav>
    </div>
  );
};

export default OutreachPage;

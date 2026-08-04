import { auth } from "@repo/auth/server";
import { Badge } from "@repo/design-system/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/design-system/components/ui/table";
import Link from "next/link";
import { ListControls } from "./list-controls";
import { Pagination } from "./pagination";
import { getProspects, parseProspectListParams } from "./queries";

const hostname = (value: string | null) => {
  if (!value) {
    return "—";
  }
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
};

const ProspectsPage = async ({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const { userId } = await auth();
  if (!userId) {
    return null;
  }
  const input = parseProspectListParams(await searchParams);
  const { prospects, total, pageCount } = await getProspects({
    userId,
    ...input,
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="font-medium text-emerald-600 text-xs uppercase tracking-[0.22em]">
          Lead inventory
        </p>
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="font-semibold text-3xl tracking-tight">Prospects</h1>
            <p className="text-muted-foreground">
              {total} matching record{total === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </div>
      <ListControls {...input} />
      {prospects.length === 0 ? (
        <div className="rounded-lg border border-dashed p-14 text-center">
          <h2 className="font-medium text-lg">
            {input.search || input.status !== "ACTIVE"
              ? "No matching prospects"
              : "Build your prospect list"}
          </h2>
          <p className="mt-2 text-muted-foreground text-sm">
            {input.search || input.status !== "ACTIVE"
              ? "Adjust the search or status filter and try again."
              : "Add the first business you want to qualify."}
          </p>
          {input.page > 1 ? (
            <Link
              className="mt-4 inline-block text-sm underline"
              href="/prospects"
            >
              Return to page one
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Business</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {prospects.map((prospect) => (
                <TableRow key={prospect.id}>
                  <TableCell>
                    <Link
                      className="font-medium hover:underline"
                      href={`/prospects/${prospect.id}`}
                    >
                      {prospect.businessName}
                    </Link>
                    <div className="text-muted-foreground text-xs">
                      {hostname(prospect.websiteUrl)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div>{prospect.contactName ?? "—"}</div>
                    <div className="text-muted-foreground text-xs">
                      {prospect.contactEmail ?? ""}
                    </div>
                  </TableCell>
                  <TableCell>{prospect.location ?? "—"}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        prospect.status === "ARCHIVED" ? "secondary" : "outline"
                      }
                    >
                      {prospect.status.toLowerCase()}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground text-xs">
                    {prospect.updatedAt.toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination input={input} page={input.page} pageCount={pageCount} />
    </div>
  );
};

export default ProspectsPage;

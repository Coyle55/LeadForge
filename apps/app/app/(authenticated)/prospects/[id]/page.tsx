import { auth } from "@repo/auth/server";
import { database } from "@repo/database";
import { Badge } from "@repo/design-system/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/ui/card";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLatestProspectAudit } from "../../audits/queries";
import { RunAuditButton } from "../../audits/run-audit-button";
import { ProspectForm } from "../prospect-form";
import { StatusButton } from "../status-button";

const ProspectDetailPage = async ({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) => {
  const [{ id }, query, { userId }] = await Promise.all([
    params,
    searchParams,
    auth(),
  ]);
  if (!userId) {
    return null;
  }
  const prospect = await database.prospect.findFirst({ where: { id, userId } });
  if (!prospect) {
    notFound();
  }
  const latestAudit = await getLatestProspectAudit(userId, prospect.id);

  const initial = {
    businessName: prospect.businessName,
    websiteUrl: prospect.websiteUrl ?? "",
    contactName: prospect.contactName ?? "",
    contactEmail: prospect.contactEmail ?? "",
    phone: prospect.phone ?? "",
    location: prospect.location ?? "",
    notes: prospect.notes ?? "",
  };
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="font-medium text-emerald-600 text-xs uppercase tracking-[0.22em]">
            Prospect record
          </p>
          <h1 className="font-semibold text-3xl tracking-tight">
            {prospect.businessName}
          </h1>
        </div>
        <Badge
          variant={prospect.status === "ARCHIVED" ? "secondary" : "outline"}
        >
          {prospect.status.toLowerCase()}
        </Badge>
      </div>
      {query.created === "1" ? (
        <p className="rounded-md border border-emerald-800/40 bg-emerald-950/20 px-4 py-3 text-emerald-600 text-sm">
          Prospect created.
        </p>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Business details</CardTitle>
          <CardDescription>
            Changes stay scoped to this owner account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProspectForm
            initial={initial}
            mode="edit"
            prospectId={prospect.id}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Website audit</CardTitle>
          <CardDescription>
            Run deterministic checks against this prospect's public website.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <div className="text-sm">
            {latestAudit ? (
              <>
                <p className="font-medium capitalize">
                  Latest: {latestAudit.status.toLowerCase()}
                </p>
                <Link
                  className="text-emerald-600 underline"
                  href={`/audits/${latestAudit.id}`}
                >
                  View result
                </Link>
              </>
            ) : (
              <p className="text-muted-foreground">No audit run yet.</p>
            )}
          </div>
          {prospect.websiteUrl ? (
            <RunAuditButton
              prospectId={prospect.id}
              rerun={Boolean(latestAudit)}
            />
          ) : (
            <Link className="text-sm underline" href="#business-details">
              Add a website first
            </Link>
          )}
        </CardContent>
      </Card>
      <div className="border-t pt-6">
        <StatusButton
          archived={prospect.status === "ARCHIVED"}
          prospectId={prospect.id}
        />
      </div>
    </div>
  );
};

export default ProspectDetailPage;

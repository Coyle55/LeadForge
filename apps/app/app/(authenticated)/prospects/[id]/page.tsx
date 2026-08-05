import { auth } from "@repo/auth/server";
import { database, type Prospect } from "@repo/database";
import { Badge } from "@repo/design-system/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/ui/card";
import { Archive, ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLatestProspectAudit } from "../../audits/queries";
import { RunAuditButton } from "../../audits/run-audit-button";
import { getProspectPipelineDetail } from "../../pipeline/queries";
import { getProspectTasks } from "../../tasks/queries";
import { BUSINESS_CATEGORY_OPTIONS, ProspectForm } from "../prospect-form";
import { StatusButton } from "../status-button";
import { PipelineDealForm } from "./pipeline-deal-form";
import { TaskForm } from "./task-form";
import { TaskList } from "./task-list";

const humanizePipelineStage = (stage: string) =>
  stage.charAt(0) + stage.slice(1).toLowerCase();

const businessCategoryLabel = (category: string | null) =>
  BUSINESS_CATEGORY_OPTIONS.find(([value]) => value === category)?.[1] ??
  "Not set";

const ArchivedNotice = () => (
  <div className="flex gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-4">
    <Archive
      aria-hidden="true"
      className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400"
    />
    <div className="text-sm">
      <p className="font-medium">Archived record</p>
      <p className="mt-1 text-muted-foreground">
        Business, pipeline, Deal, audit, and task information is read-only.
        Restore the prospect below to resume work.
      </p>
    </div>
  </div>
);

const ReadOnlyBusinessDetails = ({ prospect }: { prospect: Prospect }) => (
  <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
    <div className="sm:col-span-2">
      <dt className="text-muted-foreground text-xs">Business</dt>
      <dd className="mt-1 font-medium">{prospect.businessName}</dd>
    </div>
    <div>
      <dt className="text-muted-foreground text-xs">Business category</dt>
      <dd className="mt-1">
        {businessCategoryLabel(prospect.businessCategory)}
      </dd>
    </div>
    <div>
      <dt className="text-muted-foreground text-xs">Website</dt>
      <dd className="mt-1 break-all">
        {prospect.websiteUrl ? (
          <a
            className="inline-flex items-center gap-1 underline underline-offset-4"
            href={prospect.websiteUrl}
            rel="noreferrer"
            target="_blank"
          >
            {prospect.websiteUrl}
            <ExternalLink aria-hidden="true" className="size-3" />
          </a>
        ) : (
          "Not set"
        )}
      </dd>
    </div>
    <div>
      <dt className="text-muted-foreground text-xs">Location</dt>
      <dd className="mt-1">{prospect.location ?? "Not set"}</dd>
    </div>
    <div>
      <dt className="text-muted-foreground text-xs">Contact</dt>
      <dd className="mt-1">{prospect.contactName ?? "Not set"}</dd>
    </div>
    <div>
      <dt className="text-muted-foreground text-xs">Email</dt>
      <dd className="mt-1 break-all">{prospect.contactEmail ?? "Not set"}</dd>
    </div>
    <div>
      <dt className="text-muted-foreground text-xs">Phone</dt>
      <dd className="mt-1">{prospect.phone ?? "Not set"}</dd>
    </div>
    <div className="sm:col-span-2">
      <dt className="text-muted-foreground text-xs">Notes</dt>
      <dd className="mt-1 whitespace-pre-wrap">
        {prospect.notes ?? "Not set"}
      </dd>
    </div>
  </dl>
);

const BusinessDetailsCard = ({
  archived,
  prospect,
}: {
  archived: boolean;
  prospect: Prospect;
}) => {
  const initial = {
    businessName: prospect.businessName,
    businessCategory: prospect.businessCategory ?? "",
    contactEmail: prospect.contactEmail ?? "",
    contactName: prospect.contactName ?? "",
    location: prospect.location ?? "",
    notes: prospect.notes ?? "",
    phone: prospect.phone ?? "",
    websiteUrl: prospect.websiteUrl ?? "",
  };

  return (
    <Card id="business-details">
      <CardHeader>
        <CardTitle>Business details</CardTitle>
        <CardDescription>
          {archived
            ? "A read-only snapshot of the archived record."
            : "Changes stay scoped to this owner account."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {archived ? (
          <ReadOnlyBusinessDetails prospect={prospect} />
        ) : (
          <ProspectForm
            initial={initial}
            mode="edit"
            prospectId={prospect.id}
          />
        )}
      </CardContent>
    </Card>
  );
};

const ProspectTasksCard = ({
  archived,
  prospectId,
  tasks,
}: {
  archived: boolean;
  prospectId: string;
  tasks: Awaited<ReturnType<typeof getProspectTasks>>;
}) => (
  <Card>
    <CardHeader>
      <CardTitle>Tasks</CardTitle>
      <CardDescription>
        {archived
          ? "Follow-up history is retained without mutation controls."
          : "Create and maintain follow-ups in New York time."}
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-6">
      {archived ? null : (
        <div className="rounded-xl border bg-muted/20 p-4">
          <h3 className="mb-4 font-medium text-sm">Add follow-up</h3>
          <TaskForm
            initial={{ dueAt: null, priority: "MEDIUM", title: "" }}
            mode="create"
            prospectId={prospectId}
          />
        </div>
      )}
      <TaskList
        archived={archived}
        completedTasks={tasks.completedTasks}
        openTasks={tasks.openTasks}
      />
    </CardContent>
  </Card>
);

const WebsiteAuditCard = ({
  archived,
  latestAudit,
  prospect,
}: {
  archived: boolean;
  latestAudit: Awaited<ReturnType<typeof getLatestProspectAudit>>;
  prospect: Prospect;
}) => {
  let action = (
    <Link className="text-sm underline" href="#business-details">
      Add a website first
    </Link>
  );
  if (archived) {
    action = (
      <p className="text-muted-foreground text-xs">
        Restore to run another audit.
      </p>
    );
  } else if (prospect.websiteUrl) {
    action = (
      <RunAuditButton prospectId={prospect.id} rerun={Boolean(latestAudit)} />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Website audit</CardTitle>
        <CardDescription>
          Deterministic checks against this prospect&apos;s public website.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          {latestAudit ? (
            <>
              <p className="font-medium capitalize">
                Latest: {latestAudit.status.toLowerCase()}
              </p>
              <Link
                className="text-emerald-700 underline underline-offset-4 dark:text-emerald-400"
                href={`/audits/${latestAudit.id}`}
              >
                View result
              </Link>
            </>
          ) : (
            <p className="text-muted-foreground">No audit run yet.</p>
          )}
        </div>
        {action}
      </CardContent>
    </Card>
  );
};

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

  const [prospect, pipelineDetail, latestAudit, tasks] = await Promise.all([
    database.prospect.findFirst({ where: { id, userId } }),
    getProspectPipelineDetail(userId, id),
    getLatestProspectAudit(userId, id),
    getProspectTasks(userId, id),
  ]);
  if (!(prospect && pipelineDetail)) {
    notFound();
  }

  const archived = Boolean(pipelineDetail.archivedAt);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-medium text-emerald-700 text-xs uppercase tracking-[0.22em] dark:text-emerald-400">
            Prospect workspace
          </p>
          <h1 className="mt-1 font-semibold text-3xl tracking-tight">
            {prospect.businessName}
          </h1>
        </div>
        <div className="flex gap-2">
          <Badge variant="outline">
            {humanizePipelineStage(pipelineDetail.pipelineStage)}
          </Badge>
          <Badge variant={archived ? "secondary" : "outline"}>
            {archived ? "Archived" : "Active"}
          </Badge>
        </div>
      </div>

      {query.created === "1" ? (
        <output className="block rounded-lg border border-emerald-800/30 bg-emerald-500/[0.06] px-4 py-3 text-emerald-700 text-sm dark:text-emerald-400">
          Prospect created.
        </output>
      ) : null}

      {archived ? <ArchivedNotice /> : null}

      <BusinessDetailsCard archived={archived} prospect={prospect} />

      <PipelineDealForm
        archived={archived}
        deal={pipelineDetail.deal}
        prospectId={prospect.id}
        stage={pipelineDetail.pipelineStage}
      />

      <ProspectTasksCard
        archived={archived}
        prospectId={prospect.id}
        tasks={tasks}
      />

      <WebsiteAuditCard
        archived={archived}
        latestAudit={latestAudit}
        prospect={prospect}
      />

      <div className="border-t pt-6">
        <StatusButton archived={archived} prospectId={prospect.id} />
      </div>
    </div>
  );
};

export default ProspectDetailPage;

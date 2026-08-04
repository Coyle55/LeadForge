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
import { getOutreachDraftDetail } from "../queries";
import { DraftEditor } from "./draft-editor";
import { DraftSourceActions } from "./source-actions";

const DraftDetailPage = async ({
  params,
}: {
  params: Promise<{ id: string }>;
}) => {
  const [{ id }, { userId }] = await Promise.all([params, auth()]);
  if (!userId) {
    return null;
  }

  const draft = await getOutreachDraftDetail(userId, id);
  if (!draft) {
    notFound();
  }

  const opportunityHref = `/opportunities/${draft.analysisId}#${draft.recommendationId}`;

  if (draft.status === "FAILED") {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <p className="font-medium text-emerald-600 text-xs uppercase tracking-[0.22em]">
            Outreach draft
          </p>
          <h1 className="font-semibold text-3xl tracking-tight">
            Draft could not complete
          </h1>
        </div>
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">
              {draft.failureMessage ??
                "The outreach draft could not be completed."}
            </p>
          </CardContent>
        </Card>
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href={opportunityHref}>Retry from recommendation</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/outreach">Outreach history</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (draft.status === "RUNNING") {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <p className="font-medium text-emerald-600 text-xs uppercase tracking-[0.22em]">
            Outreach draft
          </p>
          <h1 className="font-semibold text-3xl tracking-tight">
            Drafting in progress
          </h1>
        </div>
        <Card className="overflow-hidden">
          <div className="h-1 animate-pulse bg-emerald-500" />
          <CardHeader>
            <CardTitle>Preparing grounded outreach</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              LeadForge is turning the selected recommendation into a plain-text
              message. Refresh shortly to see the completed draft.
            </p>
          </CardContent>
        </Card>
        <div className="flex flex-wrap gap-4 text-sm">
          <Link className="underline underline-offset-4" href={opportunityHref}>
            Source recommendation
          </Link>
          <Link
            className="underline underline-offset-4"
            href={`/outreach/${id}`}
          >
            Refresh status
          </Link>
        </div>
      </div>
    );
  }

  if (
    !(
      draft.subject &&
      draft.body &&
      draft.generatedSubject &&
      draft.generatedBody
    )
  ) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-7">
      <section className="grid gap-5 border-b pb-7 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div>
          <p className="font-medium text-emerald-600 text-xs uppercase tracking-[0.22em]">
            Outreach draft
          </p>
          <h1 className="font-semibold text-3xl tracking-tight">
            {draft.businessName}
          </h1>
          <p className="mt-2 text-muted-foreground">
            Prepared for{" "}
            <span className="text-foreground">{draft.recipientName}</span> at{" "}
            {draft.recipientEmail}
          </p>
        </div>
        <Badge
          className="w-fit border-emerald-600/30 text-emerald-700"
          variant="outline"
        >
          completed
        </Badge>
      </section>

      <Card>
        <CardHeader className="border-b">
          <p className="font-medium text-emerald-600 text-xs uppercase tracking-[0.18em]">
            Grounded in recommendation
          </p>
          <CardTitle>{draft.recommendationTitle}</CardTitle>
          <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1 text-muted-foreground text-sm">
            <Link
              className="underline underline-offset-4"
              href={opportunityHref}
            >
              Source opportunity
            </Link>
            <Link
              className="underline underline-offset-4"
              href={`/prospects/${draft.prospectId}`}
            >
              Recipient profile
            </Link>
            <span>{draft.websiteHostname}</span>
          </div>
          <DraftSourceActions
            auditId={draft.sourceAudit?.id}
            evidence={draft.sourceAudit?.evidence ?? []}
            recommendationId={draft.recommendationId}
          />
        </CardHeader>
        <CardContent className="pt-6">
          <DraftEditor
            body={draft.body}
            draftId={draft.id}
            generatedBody={draft.generatedBody}
            generatedSubject={draft.generatedSubject}
            subject={draft.subject}
          />
        </CardContent>
      </Card>

      <footer className="flex flex-wrap gap-x-5 gap-y-2 border-t pt-5 text-muted-foreground text-xs">
        <span>Model: {draft.model}</span>
        <span>Prompt: {draft.promptVersion}</span>
        <span>Duration: {draft.durationMs ?? "—"} ms</span>
        <time dateTime={draft.createdAt.toISOString()}>
          Created {draft.createdAt.toLocaleString()}
        </time>
      </footer>
    </div>
  );
};

export default DraftDetailPage;

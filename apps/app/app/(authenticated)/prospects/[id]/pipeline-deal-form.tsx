"use client";

import type { PipelineStage } from "@repo/database";
import { Badge } from "@repo/design-system/components/ui/badge";
import { Button } from "@repo/design-system/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/ui/card";
import { Input } from "@repo/design-system/components/ui/input";
import { Label } from "@repo/design-system/components/ui/label";
import { useActionState, useCallback, useRef, useState } from "react";
import { type PipelineFormState, saveDeal } from "../../../actions/pipeline";
import { MoveStageForm } from "../../pipeline/move-stage-form";
import {
  formatDealValueForInput,
  prepareDealFormData,
} from "./pipeline-deal-form-state";

interface DealDetail {
  actualCloseDate: Date | null;
  expectedCloseDate: Date | null;
  lossReason: string | null;
  valueCents: number | null;
}

interface RevisionAwarePipelineFormState extends PipelineFormState {
  submissionRevision?: number;
}

const DEAL_EDIT_STAGES = new Set<PipelineStage>([
  "INTERESTED",
  "PROPOSAL",
  "WON",
  "LOST",
]);

const currencyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  style: "currency",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
  year: "numeric",
});

const stageLabel = (stage: PipelineStage) =>
  stage.charAt(0) + stage.slice(1).toLowerCase();

const formatCurrency = (valueCents: number | null) =>
  valueCents === null ? "Not set" : currencyFormatter.format(valueCents / 100);

const formatDate = (value: Date | null) =>
  value ? dateFormatter.format(value) : "Not set";

const dateInputValue = (value: Date | null) =>
  value ? value.toISOString().slice(0, 10) : "";

const FieldError = ({ errors, id }: { errors?: string[]; id: string }) =>
  errors?.[0] ? (
    <p className="text-destructive text-xs" id={id}>
      {errors[0]}
    </p>
  ) : null;

const DealSummary = ({
  deal,
  stage,
}: {
  deal: DealDetail | null;
  stage: PipelineStage;
}) => {
  if (!deal) {
    return (
      <p className="rounded-lg border border-dashed p-4 text-muted-foreground text-sm">
        No Deal details have been recorded.
      </p>
    );
  }

  return (
    <dl className="grid gap-3 rounded-lg border bg-muted/20 p-4 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-muted-foreground text-xs">Deal value</dt>
        <dd className="mt-1 font-medium tabular-nums">
          {formatCurrency(deal.valueCents)}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground text-xs">Expected close</dt>
        <dd className="mt-1 font-medium">
          {formatDate(deal.expectedCloseDate)}
        </dd>
      </div>
      {stage === "WON" ? (
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground text-xs">Actual close</dt>
          <dd className="mt-1 font-medium text-emerald-700 dark:text-emerald-400">
            {formatDate(deal.actualCloseDate)}
          </dd>
        </div>
      ) : null}
      {stage === "LOST" ? (
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground text-xs">Loss reason</dt>
          <dd className="mt-1 whitespace-pre-wrap font-medium">
            {deal.lossReason ?? "Not recorded"}
          </dd>
        </div>
      ) : null}
    </dl>
  );
};

const DealEditForm = ({
  deal,
  prospectId,
}: {
  deal: DealDetail | null;
  prospectId: string;
}) => {
  const revisionRef = useRef(0);
  const [revision, setRevision] = useState(0);
  const submitDeal = useCallback(
    async (
      previousState: RevisionAwarePipelineFormState,
      formData: FormData
    ): Promise<RevisionAwarePipelineFormState> => {
      const submissionRevision = revisionRef.current;
      const result = await saveDeal(
        previousState,
        prepareDealFormData(formData)
      );
      return { ...result, submissionRevision };
    },
    []
  );
  const [state, action, pending] = useActionState<
    RevisionAwarePipelineFormState,
    FormData
  >(submitDeal, {});
  const feedbackIsCurrent = !pending && state.submissionRevision === revision;
  const feedbackState: PipelineFormState = feedbackIsCurrent ? state : {};
  const valueErrorId = `deal-value-error-${prospectId}`;
  const expectedCloseErrorId = `deal-expected-close-error-${prospectId}`;

  const markChanged = () => {
    revisionRef.current += 1;
    setRevision(revisionRef.current);
  };

  return (
    <form
      action={action}
      aria-busy={pending}
      className="space-y-4"
      onChange={markChanged}
    >
      <input name="prospectId" type="hidden" value={prospectId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`deal-value-${prospectId}`}>Deal value (USD)</Label>
          <Input
            aria-describedby={
              feedbackState.fieldErrors?.value ? valueErrorId : undefined
            }
            aria-invalid={Boolean(feedbackState.fieldErrors?.value)}
            defaultValue={formatDealValueForInput(deal?.valueCents ?? null)}
            disabled={pending}
            id={`deal-value-${prospectId}`}
            max="21474836.47"
            min="0.01"
            name="value"
            step="0.01"
            type="number"
          />
          <FieldError
            errors={feedbackState.fieldErrors?.value}
            id={valueErrorId}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`deal-close-${prospectId}`}>
            Expected close date
          </Label>
          <Input
            aria-describedby={
              feedbackState.fieldErrors?.expectedCloseDate
                ? expectedCloseErrorId
                : undefined
            }
            aria-invalid={Boolean(feedbackState.fieldErrors?.expectedCloseDate)}
            defaultValue={dateInputValue(deal?.expectedCloseDate ?? null)}
            disabled={pending}
            id={`deal-close-${prospectId}`}
            name="expectedCloseDate"
            type="date"
          />
          <FieldError
            errors={feedbackState.fieldErrors?.expectedCloseDate}
            id={expectedCloseErrorId}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending} size="sm" type="submit">
          {pending ? "Saving…" : "Save deal"}
        </Button>
        <span aria-live="polite" className="sr-only">
          {pending ? "Saving Deal details." : ""}
        </span>
        {feedbackState.message ? (
          <p
            className={
              feedbackState.status === "error"
                ? "text-destructive text-sm"
                : "text-emerald-700 text-sm dark:text-emerald-400"
            }
            role={feedbackState.status === "error" ? "alert" : "status"}
          >
            {feedbackState.message}
          </p>
        ) : null}
      </div>
    </form>
  );
};

const ActivePipelineDeal = ({
  deal,
  prospectId,
  stage,
}: {
  deal: DealDetail | null;
  prospectId: string;
  stage: PipelineStage;
}) => {
  const canEditDeal = DEAL_EDIT_STAGES.has(stage);
  const terminal = stage === "WON" || stage === "LOST";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_15rem]">
      <div className="space-y-5">
        {terminal && deal ? <DealSummary deal={deal} stage={stage} /> : null}
        {canEditDeal ? (
          <DealEditForm deal={deal} prospectId={prospectId} />
        ) : (
          <div className="space-y-3">
            <DealSummary deal={deal} stage={stage} />
            <p className="text-muted-foreground text-sm">
              Deal fields become editable when the prospect reaches Interested.
            </p>
          </div>
        )}
      </div>
      <aside className="rounded-lg border bg-muted/20 p-3">
        <MoveStageForm currentStage={stage} prospectId={prospectId} />
      </aside>
    </div>
  );
};

const ArchivedPipelineDeal = ({
  deal,
  stage,
}: {
  deal: DealDetail | null;
  stage: PipelineStage;
}) => (
  <>
    <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-3 text-sm">
      <p className="font-medium">Pipeline is read-only</p>
      <p className="mt-1 text-muted-foreground">
        Restore this prospect to move its stage or edit Deal details.
      </p>
    </div>
    <DealSummary deal={deal} stage={stage} />
  </>
);

export const PipelineDealForm = ({
  archived,
  deal,
  prospectId,
  stage,
}: {
  archived: boolean;
  deal: DealDetail | null;
  prospectId: string;
  stage: PipelineStage;
}) => (
  <Card>
    <CardHeader className="border-b">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Pipeline &amp; Deal</CardTitle>
          <CardDescription className="mt-2">
            Stage, forecast, and closing context stay together.
          </CardDescription>
        </div>
        <Badge variant="outline">{stageLabel(stage)}</Badge>
      </div>
    </CardHeader>
    <CardContent className="space-y-5">
      {archived ? (
        <ArchivedPipelineDeal deal={deal} stage={stage} />
      ) : (
        <ActivePipelineDeal deal={deal} prospectId={prospectId} stage={stage} />
      )}
    </CardContent>
  </Card>
);

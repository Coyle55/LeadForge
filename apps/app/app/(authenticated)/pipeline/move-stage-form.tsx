"use client";

import type { PipelineStage } from "@repo/database";
import { Button } from "@repo/design-system/components/ui/button";
import { Input } from "@repo/design-system/components/ui/input";
import { Label } from "@repo/design-system/components/ui/label";
import { Textarea } from "@repo/design-system/components/ui/textarea";
import { useActionState, useState } from "react";
import {
  moveProspectStage,
  type PipelineFormState,
} from "../../actions/pipeline";

const PIPELINE_STAGES = [
  "NEW",
  "CONTACTED",
  "INTERESTED",
  "PROPOSAL",
  "WON",
  "LOST",
] as const satisfies readonly PipelineStage[];

const stageLabel = (stage: PipelineStage) =>
  stage.charAt(0) + stage.slice(1).toLowerCase();

const FieldError = ({ errors, id }: { errors?: string[]; id: string }) =>
  errors?.[0] ? (
    <p className="text-destructive text-xs" id={id}>
      {errors[0]}
    </p>
  ) : null;

export const MoveStageForm = ({
  currentStage,
  prospectId,
}: {
  currentStage: PipelineStage;
  prospectId: string;
}) => {
  const [state, action, pending] = useActionState<PipelineFormState, FormData>(
    moveProspectStage,
    {}
  );
  const [destination, setDestination] = useState<PipelineStage | "">("");
  const destinationErrorId = `destination-error-${prospectId}`;
  const valueErrorId = `value-error-${prospectId}`;
  const actualCloseErrorId = `actual-close-error-${prospectId}`;
  const lossReasonErrorId = `loss-reason-error-${prospectId}`;

  return (
    <form action={action} aria-busy={pending} className="space-y-3">
      <input name="prospectId" type="hidden" value={prospectId} />
      <div className="space-y-1.5">
        <Label
          className="text-[11px] text-muted-foreground uppercase tracking-[0.14em]"
          htmlFor={`destination-${prospectId}`}
        >
          Move to
        </Label>
        <select
          aria-describedby={
            state.fieldErrors?.destination ? destinationErrorId : undefined
          }
          aria-invalid={Boolean(state.fieldErrors?.destination)}
          className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30"
          disabled={pending}
          id={`destination-${prospectId}`}
          name="destination"
          onChange={(event) =>
            setDestination(event.target.value as PipelineStage | "")
          }
          value={destination}
        >
          <option value="">Select stage</option>
          {PIPELINE_STAGES.filter((stage) => stage !== currentStage).map(
            (stage) => (
              <option key={stage} value={stage}>
                {stageLabel(stage)}
              </option>
            )
          )}
        </select>
        <FieldError
          errors={state.fieldErrors?.destination}
          id={destinationErrorId}
        />
      </div>
      {destination === "WON" ? (
        <div className="space-y-3 rounded-md border border-emerald-600/20 bg-emerald-500/[0.04] p-2.5">
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor={`value-${prospectId}`}>
              Deal value (USD)
            </Label>
            <Input
              aria-describedby={
                state.fieldErrors?.value ? valueErrorId : undefined
              }
              aria-invalid={Boolean(state.fieldErrors?.value)}
              className="h-8 text-xs"
              disabled={pending}
              id={`value-${prospectId}`}
              max="21474836.47"
              min="0.01"
              name="value"
              required
              step="0.01"
              type="number"
            />
            <FieldError errors={state.fieldErrors?.value} id={valueErrorId} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor={`actual-close-${prospectId}`}>
              Actual close date
            </Label>
            <Input
              aria-describedby={
                state.fieldErrors?.actualCloseDate
                  ? actualCloseErrorId
                  : undefined
              }
              aria-invalid={Boolean(state.fieldErrors?.actualCloseDate)}
              className="h-8 text-xs"
              disabled={pending}
              id={`actual-close-${prospectId}`}
              name="actualCloseDate"
              required
              type="date"
            />
            <FieldError
              errors={state.fieldErrors?.actualCloseDate}
              id={actualCloseErrorId}
            />
          </div>
        </div>
      ) : null}
      {destination === "LOST" ? (
        <div className="space-y-1.5 rounded-md border border-destructive/20 bg-destructive/[0.04] p-2.5">
          <Label className="text-xs" htmlFor={`loss-reason-${prospectId}`}>
            Loss reason
          </Label>
          <Textarea
            aria-describedby={
              state.fieldErrors?.lossReason ? lossReasonErrorId : undefined
            }
            aria-invalid={Boolean(state.fieldErrors?.lossReason)}
            className="min-h-20 resize-y text-xs"
            disabled={pending}
            id={`loss-reason-${prospectId}`}
            maxLength={500}
            name="lossReason"
            required
            rows={3}
          />
          <FieldError
            errors={state.fieldErrors?.lossReason}
            id={lossReasonErrorId}
          />
        </div>
      ) : null}
      <Button
        className="h-8 w-full text-xs"
        disabled={pending || destination === ""}
        size="sm"
        type="submit"
        variant="outline"
      >
        {pending ? "Moving…" : "Move prospect"}
      </Button>
      <output aria-live="polite" className="sr-only">
        {pending ? "Moving prospect." : ""}
      </output>
      {state.message ? (
        <p
          className={
            state.status === "error"
              ? "rounded-md bg-destructive/8 px-2 py-1.5 text-destructive text-xs"
              : "rounded-md bg-emerald-500/8 px-2 py-1.5 text-emerald-700 text-xs dark:text-emerald-400"
          }
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
};

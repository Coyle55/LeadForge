"use client";

import { Button } from "@repo/design-system/components/ui/button";
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/design-system/components/ui/dialog";
import { Input } from "@repo/design-system/components/ui/input";
import { Label } from "@repo/design-system/components/ui/label";
import { useActionState, useCallback, useRef } from "react";
import {
  type ProspectImportBatchContext,
  searchProspects,
} from "../../actions/discovery";
import type { ProspectDiscoveryResult } from "../../lib/discovery/types";
import { DiscoverResults } from "./discover-results";

const DEFAULT_LOCATION = "Cincinnati, OH";
const DEFAULT_RESULT_LIMIT = 10;

interface SearchFormState {
  fieldErrors?: Record<string, string[]>;
  message?: string;
  requestedCount?: number;
  result?: ProspectDiscoveryResult & {
    duplicateProspectIds: Record<string, string | null>;
  };
  // Bumped on every submission (success or error) so `<DiscoverResults
  // key={searchRevision} />` fully remounts -- clearing selection and any
  // prior import outcome -- whenever a new search completes, even if the
  // dialog is never closed between searches.
  searchRevision?: number;
  status?: "success" | "error";
}

const FieldError = ({ errors, id }: { errors?: string[]; id: string }) =>
  errors?.[0] ? (
    <p className="text-destructive text-xs" id={id}>
      {errors[0]}
    </p>
  ) : null;

export const DiscoverModal = () => {
  const searchRevisionRef = useRef(0);
  const search = useCallback(
    async (
      _previousState: SearchFormState,
      formData: FormData
    ): Promise<SearchFormState> => {
      searchRevisionRef.current += 1;
      const searchRevision = searchRevisionRef.current;
      const businessType = String(formData.get("businessType") ?? "");
      const location = String(formData.get("location") ?? "");
      const resultLimit = Number(formData.get("resultLimit"));

      const response = await searchProspects({
        businessType,
        location,
        resultLimit,
      });

      if (response.status === "error") {
        return {
          fieldErrors: response.fieldErrors,
          message: response.message,
          searchRevision,
          status: "error",
        };
      }

      return {
        requestedCount: resultLimit,
        result: response.result,
        searchRevision,
        status: "success",
      };
    },
    []
  );
  const [state, action, pending] = useActionState<SearchFormState, FormData>(
    search,
    {}
  );

  const businessTypeErrorId = "discover-business-type-error";
  const locationErrorId = "discover-location-error";
  const resultLimitErrorId = "discover-result-limit-error";

  const batchContext: ProspectImportBatchContext | null = state.result
    ? {
        location: state.result.location,
        provider: state.result.provider,
        query: state.result.query,
        reasoningModel: state.result.reasoningModel,
        requestedCount: state.requestedCount ?? state.result.results.length,
        returnedCount: state.result.results.length,
      }
    : null;

  return (
    <DialogContent className="max-h-[85vh] w-[95vw] overflow-y-auto sm:max-w-6xl">
      <DialogHeader>
        <DialogTitle>Discover prospects</DialogTitle>
        <DialogDescription>
          Search for local businesses to add to your pipeline. Results are
          previewed here first — nothing is saved until you import.
        </DialogDescription>
      </DialogHeader>
      <form action={action} aria-busy={pending} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="discover-business-type">Business type</Label>
            <Input
              aria-describedby={
                state.fieldErrors?.businessType
                  ? businessTypeErrorId
                  : undefined
              }
              aria-invalid={Boolean(state.fieldErrors?.businessType)}
              disabled={pending}
              id="discover-business-type"
              name="businessType"
              required
            />
            <FieldError
              errors={state.fieldErrors?.businessType}
              id={businessTypeErrorId}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="discover-location">Location</Label>
            <Input
              aria-describedby={
                state.fieldErrors?.location ? locationErrorId : undefined
              }
              aria-invalid={Boolean(state.fieldErrors?.location)}
              defaultValue={DEFAULT_LOCATION}
              disabled={pending}
              id="discover-location"
              name="location"
              required
            />
            <FieldError
              errors={state.fieldErrors?.location}
              id={locationErrorId}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="discover-result-limit">Result limit</Label>
            <Input
              aria-describedby={
                state.fieldErrors?.resultLimit ? resultLimitErrorId : undefined
              }
              aria-invalid={Boolean(state.fieldErrors?.resultLimit)}
              defaultValue={DEFAULT_RESULT_LIMIT}
              disabled={pending}
              id="discover-result-limit"
              max={25}
              min={1}
              name="resultLimit"
              required
              type="number"
            />
            <FieldError
              errors={state.fieldErrors?.resultLimit}
              id={resultLimitErrorId}
            />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={pending} type="submit">
            {pending ? "Searching…" : "Search"}
          </Button>
        </DialogFooter>
        <output aria-live="polite" className="sr-only">
          {pending ? "Searching for prospects." : ""}
        </output>
        {state.message && state.status === "error" ? (
          <p
            className="rounded-md bg-destructive/8 px-2 py-1.5 text-destructive text-xs"
            role="alert"
          >
            {state.message}
          </p>
        ) : null}
      </form>
      {state.status === "success" && state.result && batchContext ? (
        <DiscoverResults
          batchContext={batchContext}
          candidates={state.result.results}
          duplicateProspectIds={state.result.duplicateProspectIds}
          key={state.searchRevision}
        />
      ) : null}
    </DialogContent>
  );
};

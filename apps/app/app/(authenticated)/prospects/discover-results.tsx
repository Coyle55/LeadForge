"use client";

import { Badge } from "@repo/design-system/components/ui/badge";
import { Button } from "@repo/design-system/components/ui/button";
import { Checkbox } from "@repo/design-system/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/design-system/components/ui/table";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  type ImportAndAuditProspectsResult,
  type ImportProspectsResult,
  importAndAuditProspects,
  importProspects,
  type ProspectImportBatchContext,
} from "../../actions/discovery";
import type {
  DiscoveredProspect,
  DiscoveryConfidence,
} from "../../lib/discovery/types";

type DuplicateProspectIds = Record<string, string | null>;

// Pure and directly testable: a candidate can only be selected for import
// when it has a verified website (the server re-enforces this too -- see
// importProspects) AND it is not already a duplicate of an existing,
// non-archived prospect for this owner.
export const isImportEligible = (
  candidate: DiscoveredProspect,
  duplicateProspectIds: DuplicateProspectIds
): boolean =>
  Boolean(candidate.websiteUrl?.trim()) &&
  candidate.websiteVerified &&
  !duplicateProspectIds[candidate.discoveryId];

// Human-readable reason a candidate's checkbox is disabled, shown as a
// label/tooltip next to the disabled checkbox. Returns null for eligible
// candidates (no reason needed).
export const getIneligibilityReason = (
  candidate: DiscoveredProspect,
  duplicateProspectIds: DuplicateProspectIds
): string | null => {
  if (duplicateProspectIds[candidate.discoveryId]) {
    return "Already imported";
  }
  if (!candidate.websiteUrl?.trim()) {
    return "No website found";
  }
  if (!candidate.websiteVerified) {
    return "Website not verified";
  }
  return null;
};

const confidenceVariant: Record<
  DiscoveryConfidence,
  "default" | "secondary" | "outline"
> = {
  HIGH: "default",
  MEDIUM: "secondary",
  LOW: "outline",
};

const formatAddress = (candidate: DiscoveredProspect): string | null => {
  if (candidate.formattedAddress) {
    return candidate.formattedAddress;
  }
  const cityState = [candidate.city, candidate.state]
    .filter(Boolean)
    .join(", ");
  return cityState.length > 0 ? cityState : null;
};

type ImportOutcome = ImportProspectsResult | ImportAndAuditProspectsResult;

const businessNameByDiscoveryId = (candidates: DiscoveredProspect[]) =>
  new Map(candidates.map((candidate) => [candidate.discoveryId, candidate]));

const ImportSummary = ({
  candidates,
  outcome,
}: {
  candidates: DiscoveredProspect[];
  outcome: ImportOutcome;
}) => {
  if (outcome.status === "error") {
    return (
      <p
        className="rounded-md bg-destructive/8 px-3 py-2 text-destructive text-sm"
        role="alert"
      >
        {outcome.message}
      </p>
    );
  }

  const byId = businessNameByDiscoveryId(candidates);
  const audits = "audits" in outcome ? outcome.audits : null;

  return (
    <output className="block space-y-2 rounded-md border border-border/70 bg-muted/30 p-3 text-sm">
      <p className="font-medium">
        Imported {outcome.imported.length}, skipped {outcome.skipped.length},
        failed {outcome.failed.length}
        {audits ? `, audited ${audits.length}` : ""}.
      </p>
      {outcome.skipped.length > 0 ? (
        <p className="text-muted-foreground text-xs">
          Skipped (already imported):{" "}
          {outcome.skipped
            .map((id) => byId.get(id)?.businessName ?? id)
            .join(", ")}
        </p>
      ) : null}
      {outcome.failed.length > 0 ? (
        <ul className="space-y-0.5 text-destructive text-xs">
          {outcome.failed.map((failure) => (
            <li key={failure.discoveryId}>
              {byId.get(failure.discoveryId)?.businessName ??
                failure.discoveryId}
              : {failure.reason}
            </li>
          ))}
        </ul>
      ) : null}
      {audits && audits.length > 0 ? (
        <ul className="space-y-0.5 text-muted-foreground text-xs">
          {audits.map((audit) => (
            <li key={audit.prospectId}>
              Audit for prospect {audit.prospectId}:{" "}
              {audit.status === "succeeded" ? "succeeded" : "failed"}
            </li>
          ))}
        </ul>
      ) : null}
    </output>
  );
};

export const DiscoverResults = ({
  batchContext,
  candidates,
  duplicateProspectIds,
}: {
  batchContext: ProspectImportBatchContext;
  candidates: DiscoveredProspect[];
  duplicateProspectIds: DuplicateProspectIds;
}) => {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    new Set()
  );
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [pending, startTransition] = useTransition();

  const eligibleIds = useMemo(
    () =>
      new Set(
        candidates
          .filter((candidate) =>
            isImportEligible(candidate, duplicateProspectIds)
          )
          .map((candidate) => candidate.discoveryId)
      ),
    [candidates, duplicateProspectIds]
  );

  const allEligibleSelected =
    eligibleIds.size > 0 && [...eligibleIds].every((id) => selectedIds.has(id));

  const toggleCandidate = (discoveryId: string, checked: boolean) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (checked) {
        next.add(discoveryId);
      } else {
        next.delete(discoveryId);
      }
      return next;
    });
  };

  const toggleSelectAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(eligibleIds) : new Set());
  };

  const runImport = (
    action: (
      candidates: DiscoveredProspect[],
      batchContext: ProspectImportBatchContext
    ) => Promise<ImportOutcome>
  ) => {
    const selected = candidates.filter((candidate) =>
      selectedIds.has(candidate.discoveryId)
    );
    startTransition(async () => {
      const result = await action(selected, batchContext);
      setOutcome(result);
    });
  };

  if (candidates.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No candidates matched this search.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <Checkbox
                  aria-label="Select all eligible candidates"
                  checked={allEligibleSelected}
                  disabled={pending || eligibleIds.size === 0}
                  onCheckedChange={(checked) =>
                    toggleSelectAll(checked === true)
                  }
                />
              </TableHead>
              <TableHead>Business</TableHead>
              <TableHead>Website</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Address</TableHead>
              <TableHead>Confidence</TableHead>
              <TableHead>Sources</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {candidates.map((candidate) => {
              const eligible = eligibleIds.has(candidate.discoveryId);
              const reason = getIneligibilityReason(
                candidate,
                duplicateProspectIds
              );
              const duplicateId = duplicateProspectIds[candidate.discoveryId];
              const address = formatAddress(candidate);

              return (
                <TableRow key={candidate.discoveryId}>
                  <TableCell>
                    <Checkbox
                      aria-label={
                        eligible
                          ? `Select ${candidate.businessName}`
                          : (reason ?? "Not eligible for import")
                      }
                      checked={selectedIds.has(candidate.discoveryId)}
                      disabled={pending || !eligible}
                      onCheckedChange={(checked) =>
                        toggleCandidate(candidate.discoveryId, checked === true)
                      }
                      title={eligible ? undefined : (reason ?? undefined)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{candidate.businessName}</div>
                    {candidate.category ? (
                      <div className="text-muted-foreground text-xs">
                        {candidate.category}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {candidate.websiteVerified && candidate.websiteUrl ? (
                      <a
                        className="underline"
                        href={candidate.websiteUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {candidate.websiteUrl}
                      </a>
                    ) : (
                      <Badge variant="outline">
                        Official website not verified
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{candidate.phone ?? "—"}</TableCell>
                  <TableCell>{address ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={confidenceVariant[candidate.confidence]}>
                      {candidate.confidence}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <ul className="space-y-0.5">
                      {candidate.sourceUrls.map((sourceUrl) => (
                        <li key={sourceUrl}>
                          <a
                            className="text-muted-foreground text-xs underline"
                            href={sourceUrl}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {sourceUrl}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </TableCell>
                  <TableCell>
                    {duplicateId ? (
                      <Link
                        className="text-muted-foreground text-xs underline"
                        href={`/prospects/${duplicateId}`}
                      >
                        Already Imported
                      </Link>
                    ) : (
                      <span className="text-muted-foreground text-xs">
                        {reason ?? "New"}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={pending || selectedIds.size === 0}
          onClick={() => runImport(importProspects)}
          type="button"
          variant="outline"
        >
          {pending ? "Importing…" : "Import Selected"}
        </Button>
        <Button
          disabled={pending || selectedIds.size === 0}
          onClick={() => runImport(importAndAuditProspects)}
          type="button"
        >
          {pending ? "Importing…" : "Import + Audit Selected"}
        </Button>
        <output aria-live="polite" className="sr-only">
          {pending ? "Importing selected candidates." : ""}
        </output>
      </div>
      {outcome ? (
        <ImportSummary candidates={candidates} outcome={outcome} />
      ) : null}
    </div>
  );
};

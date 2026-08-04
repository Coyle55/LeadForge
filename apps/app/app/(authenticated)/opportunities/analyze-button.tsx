"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { useState, useTransition } from "react";
import { analyzeAuditOpportunity } from "../../actions/opportunities";

export const AnalyzeButton = ({ auditId }: { auditId: string }) => {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  return (
    <div className="space-y-2">
      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(undefined);
            const result = await analyzeAuditOpportunity(auditId);
            if (result?.status === "error") {
              setError(result.message);
            }
          })
        }
      >
        {pending ? "Analyzing…" : "Analyze opportunity"}
      </Button>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
};

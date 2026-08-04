"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { useState, useTransition } from "react";
import { runProspectAudit } from "../../actions/audits";

export const RunAuditButton = ({
  prospectId,
  rerun = false,
}: {
  prospectId: string;
  rerun?: boolean;
}) => {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const label = pending ? "Auditing…" : "Run audit";
  return (
    <div className="space-y-2">
      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(undefined);
            const result = await runProspectAudit(prospectId);
            if (result?.status === "error") {
              setError(result.message);
            }
          })
        }
      >
        {rerun && !pending ? "Run again" : label}
      </Button>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
};

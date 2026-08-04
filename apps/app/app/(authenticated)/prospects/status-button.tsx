"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { archiveProspect, restoreProspect } from "../../actions/prospects";

export const StatusButton = ({
  prospectId,
  archived,
}: {
  prospectId: string;
  archived: boolean;
}) => {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  let buttonLabel = archived ? "Restore prospect" : "Archive prospect";
  if (pending) {
    buttonLabel = "Updating…";
  }
  const run = () =>
    startTransition(async () => {
      const result = archived
        ? await restoreProspect(prospectId)
        : await archiveProspect(prospectId);
      setMessage(result.message);
      if (result.status === "success") {
        router.refresh();
      }
    });
  return (
    <div className="flex items-center gap-3">
      <Button disabled={pending} onClick={run} type="button" variant="outline">
        {buttonLabel}
      </Button>
      {message ? (
        <span className="text-muted-foreground text-sm">{message}</span>
      ) : null}
    </div>
  );
};

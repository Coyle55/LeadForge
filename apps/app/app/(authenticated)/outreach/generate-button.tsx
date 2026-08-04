"use client";

import { Button } from "@repo/design-system/components/ui/button";
import Link from "next/link";
import { useState, useTransition } from "react";
import {
  generateOutreachDraft,
  type OutreachActionError,
} from "../../actions/outreach";

export const GenerateOutreachButton = ({
  recommendationId,
}: {
  recommendationId: string;
}) => {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<OutreachActionError>();

  return (
    <div className="space-y-2">
      <Button
        aria-busy={pending}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(undefined);
            const result = await generateOutreachDraft(recommendationId);
            if (result?.status === "error") {
              setError(result);
            }
          })
        }
        size="sm"
      >
        {pending ? "Drafting…" : "Draft outreach"}
      </Button>
      {error ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <p className="text-destructive" role="alert">
            {error.message}
          </p>
          {error.href ? (
            <Link
              className="font-medium underline underline-offset-4"
              href={error.href}
            >
              Fix this
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

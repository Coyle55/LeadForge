import { Button } from "@repo/design-system/components/ui/button";
import Link from "next/link";
import { GenerateOutreachButton } from "../generate-button";

export const DraftSourceActions = ({
  auditId,
  evidence,
  recommendationId,
}: {
  auditId?: string;
  evidence: { key: string; label: string }[];
  recommendationId: string;
}) => {
  const primaryEvidenceHref = auditId
    ? `/audits/${auditId}${evidence[0] ? `#${evidence[0].key}` : ""}`
    : null;

  return (
    <div className="space-y-3 pt-3">
      <div className="flex flex-wrap items-start gap-3">
        {primaryEvidenceHref ? (
          <Button asChild size="sm" variant="outline">
            <Link href={primaryEvidenceHref}>View audit evidence</Link>
          </Button>
        ) : null}
        <GenerateOutreachButton
          label="Regenerate"
          recommendationId={recommendationId}
        />
      </div>
      {auditId && evidence.length ? (
        <div className="flex flex-wrap gap-2">
          {evidence.map((item) => (
            <Link
              className="rounded-full border px-2.5 py-1 text-muted-foreground text-xs hover:text-foreground"
              href={`/audits/${auditId}#${item.key}`}
              key={item.key}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
};

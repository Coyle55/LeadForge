import { Button } from "@repo/design-system/components/ui/button";
import Link from "next/link";
import type { ProspectListInput } from "./queries";

const pageHref = (page: number, { search, status }: ProspectListInput) => {
  const params = new URLSearchParams({ page: String(page), status });
  if (search) {
    params.set("search", search);
  }
  return `/prospects?${params.toString()}`;
};

export const Pagination = ({
  page,
  pageCount,
  input,
}: {
  page: number;
  pageCount: number;
  input: ProspectListInput;
}) => {
  if (pageCount <= 1 && page === 1) {
    return null;
  }

  return (
    <div className="flex items-center justify-between pt-5 text-muted-foreground text-sm">
      <span>
        Page {page} of {Math.max(pageCount, 1)}
      </span>
      <div className="flex gap-2">
        <Button
          asChild={page > 1}
          disabled={page <= 1}
          size="sm"
          variant="outline"
        >
          {page > 1 ? (
            <Link href={pageHref(page - 1, input)}>Previous</Link>
          ) : (
            <span>Previous</span>
          )}
        </Button>
        <Button
          asChild={page < pageCount}
          disabled={page >= pageCount}
          size="sm"
          variant="outline"
        >
          {page < pageCount ? (
            <Link href={pageHref(page + 1, input)}>Next</Link>
          ) : (
            <span>Next</span>
          )}
        </Button>
      </div>
    </div>
  );
};

import { Button } from "@repo/design-system/components/ui/button";
import { Input } from "@repo/design-system/components/ui/input";
import Link from "next/link";
import type { ProspectListInput } from "./queries";

export const ListControls = ({ search, status }: ProspectListInput) => (
  <div className="flex flex-col gap-3 border-border/70 border-y py-4 sm:flex-row sm:items-center">
    <form className="flex flex-1 flex-col gap-3 sm:flex-row" method="get">
      <Input
        className="max-w-lg bg-background"
        defaultValue={search}
        name="search"
        placeholder="Search business, website, contact…"
        type="search"
      />
      <select
        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        defaultValue={status}
        name="status"
      >
        <option value="ACTIVE">Active</option>
        <option value="NEW">New</option>
        <option value="QUALIFIED">Qualified</option>
        <option value="ARCHIVED">Archived</option>
      </select>
      <Button type="submit" variant="outline">
        Apply
      </Button>
    </form>
    <Button asChild>
      <Link href="/prospects/new">Add prospect</Link>
    </Button>
  </div>
);

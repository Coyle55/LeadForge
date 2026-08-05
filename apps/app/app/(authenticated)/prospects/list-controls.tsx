import { Button } from "@repo/design-system/components/ui/button";
import { Input } from "@repo/design-system/components/ui/input";
import Link from "next/link";
import type { ProspectListInput } from "./queries";

export const ListControls = ({ search, stage, status }: ProspectListInput) => (
  <div className="flex flex-col gap-3 border-border/70 border-y py-4 sm:flex-row sm:items-center">
    <form
      className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-end"
      method="get"
    >
      <Input
        className="max-w-lg bg-background"
        defaultValue={search}
        name="search"
        placeholder="Search business, website, contact…"
        type="search"
      />
      <div className="space-y-1.5">
        <label
          className="block font-medium text-muted-foreground text-xs uppercase tracking-[0.12em]"
          htmlFor="prospect-archive-state"
        >
          Archive state
        </label>
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          defaultValue={status}
          id="prospect-archive-state"
          name="status"
        >
          <option value="ACTIVE">Active</option>
          <option value="ARCHIVED">Archived</option>
        </select>
      </div>
      <div className="space-y-1.5">
        <label
          className="block font-medium text-muted-foreground text-xs uppercase tracking-[0.12em]"
          htmlFor="prospect-pipeline-stage"
        >
          Pipeline stage
        </label>
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          defaultValue={stage ?? ""}
          id="prospect-pipeline-stage"
          name="stage"
        >
          <option value="">All pipeline stages</option>
          <option value="NEW">New</option>
          <option value="CONTACTED">Contacted</option>
          <option value="INTERESTED">Interested</option>
          <option value="PROPOSAL">Proposal</option>
          <option value="WON">Won</option>
          <option value="LOST">Lost</option>
        </select>
      </div>
      <Button type="submit" variant="outline">
        Apply
      </Button>
    </form>
    <Button asChild>
      <Link href="/prospects/new">Add prospect</Link>
    </Button>
  </div>
);

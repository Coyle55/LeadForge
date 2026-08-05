import { Button } from "@repo/design-system/components/ui/button";
import Link from "next/link";
import type { TaskListPriority, TaskListStatus } from "./queries";

const selectClassName =
  "h-9 min-w-40 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

export const TaskControls = ({
  priority,
  status,
}: {
  priority: TaskListPriority;
  status: TaskListStatus;
}) => (
  <div className="flex flex-col gap-3 border-border/70 border-y py-4 sm:flex-row sm:items-end sm:justify-between">
    <form
      aria-label="Filter tasks"
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      method="get"
    >
      <label className="space-y-1.5 text-muted-foreground text-xs">
        <span className="block font-medium uppercase tracking-[0.12em]">
          Status
        </span>
        <select className={selectClassName} defaultValue={status} name="status">
          <option value="OPEN">Open</option>
          <option value="DUE_TODAY">Due today</option>
          <option value="OVERDUE">Overdue</option>
          <option value="COMPLETED">Completed</option>
        </select>
      </label>
      <label className="space-y-1.5 text-muted-foreground text-xs">
        <span className="block font-medium uppercase tracking-[0.12em]">
          Priority
        </span>
        <select
          className={selectClassName}
          defaultValue={priority}
          name="priority"
        >
          <option value="ALL">All priorities</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </select>
      </label>
      <Button type="submit" variant="outline">
        Apply filters
      </Button>
    </form>
    <Button asChild size="sm" variant="ghost">
      <Link href="/tasks">Clear filters</Link>
    </Button>
  </div>
);

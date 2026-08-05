import { auth } from "@repo/auth/server";
import type { TaskPriority } from "@repo/database";
import { Badge } from "@repo/design-system/components/ui/badge";
import { Button } from "@repo/design-system/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/design-system/components/ui/table";
import { CalendarCheck2, ListTodo } from "lucide-react";
import Link from "next/link";
import { APP_TIME_ZONE, getTaskDayBounds } from "../../lib/tasks/time";
import {
  getTasks,
  parseTaskListParams,
  type TaskListPriority,
  type TaskListStatus,
} from "./queries";
import { TaskControls } from "./task-controls";
import { TaskStatusButton } from "./task-status-button";

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  timeZone: APP_TIME_ZONE,
  timeZoneName: "short",
  year: "numeric",
});

const priorityClassName: Record<TaskPriority, string> = {
  HIGH: "border-rose-500/25 bg-rose-500/[0.07] text-rose-700 dark:text-rose-300",
  MEDIUM:
    "border-amber-500/25 bg-amber-500/[0.07] text-amber-700 dark:text-amber-300",
  LOW: "border-slate-500/20 bg-slate-500/[0.06] text-slate-600 dark:text-slate-300",
};

const statusClassName = {
  Completed:
    "border-emerald-500/25 bg-emerald-500/[0.07] text-emerald-700 dark:text-emerald-300",
  "Due today":
    "border-sky-500/25 bg-sky-500/[0.07] text-sky-700 dark:text-sky-300",
  Open: "border-slate-500/20 bg-slate-500/[0.06] text-slate-600 dark:text-slate-300",
  Overdue:
    "border-rose-500/25 bg-rose-500/[0.07] text-rose-700 dark:text-rose-300",
} as const;

const taskHref = ({
  page,
  priority,
  status,
}: {
  page: number;
  priority: TaskListPriority;
  status: TaskListStatus;
}) => {
  const params = new URLSearchParams({
    page: String(page),
    priority,
    status,
  });
  return `/tasks?${params.toString()}`;
};

const TasksPage = async ({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const [{ userId }, rawParams] = await Promise.all([auth(), searchParams]);
  if (!userId) {
    return null;
  }

  const input = parseTaskListParams(rawParams);
  const now = new Date();
  const dayBounds = getTaskDayBounds(now);
  const { tasks, total, pageCount } = await getTasks({
    userId,
    now,
    ...input,
  });
  const displayStatus = (task: (typeof tasks)[number]) => {
    if (task.status === "COMPLETED") {
      return "Completed" as const;
    }
    if (task.dueAt.getTime() < now.getTime()) {
      return "Overdue" as const;
    }
    if (task.dueAt >= dayBounds.start && task.dueAt < dayBounds.end) {
      return "Due today" as const;
    }
    return "Open" as const;
  };
  const hasFilters = input.status !== "OPEN" || input.priority !== "ALL";
  const pageOneHref = taskHref({ ...input, page: 1 });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-medium text-emerald-700 text-xs uppercase tracking-[0.22em] dark:text-emerald-400">
            Follow-up queue
          </p>
          <h1 className="mt-1 font-semibold text-3xl tracking-tight">Tasks</h1>
          <p className="mt-1 max-w-xl text-muted-foreground text-sm">
            Triage every owner-scoped follow-up by due time and priority.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3 rounded-lg border bg-card px-3.5 py-2.5 shadow-xs">
          <ListTodo aria-hidden="true" className="size-4 text-emerald-600" />
          <span className="font-mono font-semibold text-xl tabular-nums">
            {total}
          </span>
          <span className="text-muted-foreground text-xs">
            matching {total === 1 ? "task" : "tasks"}
          </span>
        </div>
      </div>

      <TaskControls priority={input.priority} status={input.status} />

      {tasks.length === 0 ? (
        <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed bg-muted/15 px-6 text-center">
          <span className="mb-4 flex size-11 items-center justify-center rounded-lg border bg-background shadow-xs">
            <CalendarCheck2
              aria-hidden="true"
              className="size-5 text-muted-foreground"
            />
          </span>
          <h2 className="font-medium text-lg">
            {hasFilters || input.page > 1
              ? "No tasks match this view"
              : "Nothing is queued"}
          </h2>
          <p className="mt-2 max-w-sm text-muted-foreground text-sm">
            {hasFilters || input.page > 1
              ? "Adjust the status or priority filter to widen the queue."
              : "Create a task from a prospect record when a follow-up is needed."}
          </p>
          {input.page > 1 ? (
            <Button asChild className="mt-4" size="sm" variant="outline">
              <Link href={pageOneHref}>Return to page one</Link>
            </Button>
          ) : null}
        </div>
      ) : (
        <section
          aria-label="Task results; scroll horizontally for all columns"
          className="overflow-x-auto rounded-xl border bg-card shadow-xs [&_[data-slot=table-container]]:overflow-visible"
        >
          <Table className="min-w-[52rem]">
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead>Task</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((task) => {
                const taskStatus = displayStatus(task);
                return (
                  <TableRow key={task.id}>
                    <TableCell className="min-w-60 whitespace-normal py-3">
                      <p className="font-medium leading-snug">{task.title}</p>
                      <Link
                        className="mt-1 inline-block text-muted-foreground text-xs underline-offset-4 hover:text-foreground hover:underline"
                        href={`/prospects/${task.prospectId}`}
                      >
                        {task.prospectName}
                      </Link>
                    </TableCell>
                    <TableCell className="min-w-52">
                      <time
                        className="text-sm tabular-nums"
                        dateTime={task.dueAt.toISOString()}
                      >
                        {dateTimeFormatter.format(task.dueAt)}
                      </time>
                      {task.completedAt ? (
                        <p className="mt-1 text-muted-foreground text-xs">
                          Completed {dateTimeFormatter.format(task.completedAt)}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={priorityClassName[task.priority]}
                        variant="outline"
                      >
                        {task.priority.charAt(0) +
                          task.priority.slice(1).toLowerCase()}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={statusClassName[taskStatus]}
                        variant="outline"
                      >
                        {taskStatus}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end">
                        <TaskStatusButton
                          status={task.status}
                          taskId={task.id}
                          taskTitle={task.title}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </section>
      )}

      {pageCount > 1 || input.page > 1 ? (
        <nav
          aria-label="Task pages"
          className="flex items-center justify-between border-t pt-5 text-muted-foreground text-sm"
        >
          <span>
            Page {input.page} of {Math.max(pageCount, 1)}
          </span>
          <div className="flex gap-2">
            <Button
              asChild={input.page > 1}
              disabled={input.page <= 1}
              size="sm"
              variant="outline"
            >
              {input.page > 1 ? (
                <Link href={taskHref({ ...input, page: input.page - 1 })}>
                  Previous
                </Link>
              ) : (
                <span>Previous</span>
              )}
            </Button>
            <Button
              asChild={input.page < pageCount}
              disabled={input.page >= pageCount}
              size="sm"
              variant="outline"
            >
              {input.page < pageCount ? (
                <Link href={taskHref({ ...input, page: input.page + 1 })}>
                  Next
                </Link>
              ) : (
                <span>Next</span>
              )}
            </Button>
          </div>
        </nav>
      ) : null}
    </div>
  );
};

export default TasksPage;

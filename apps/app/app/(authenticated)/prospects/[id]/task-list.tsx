import type { Task, TaskPriority } from "@repo/database";
import { Badge } from "@repo/design-system/components/ui/badge";
import { CalendarClock, CheckCircle2, Circle } from "lucide-react";
import { APP_TIME_ZONE } from "../../../lib/tasks/time";
import { TaskStatusButton } from "../../tasks/task-status-button";
import { TaskForm } from "./task-form";

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

const TaskItem = ({ archived, task }: { archived: boolean; task: Task }) => (
  <article className="rounded-lg border bg-background p-3.5 shadow-xs">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {task.status === "COMPLETED" ? (
            <CheckCircle2
              aria-hidden="true"
              className="size-4 text-emerald-600"
            />
          ) : (
            <Circle
              aria-hidden="true"
              className="size-4 text-muted-foreground"
            />
          )}
          <h4 className="font-medium text-sm">{task.title}</h4>
          <Badge className={priorityClassName[task.priority]} variant="outline">
            {task.priority.charAt(0) + task.priority.slice(1).toLowerCase()}
          </Badge>
        </div>
        <p className="flex items-center gap-2 text-muted-foreground text-xs">
          <CalendarClock aria-hidden="true" className="size-3.5" />
          <span>Due</span>
          <time className="tabular-nums" dateTime={task.dueAt.toISOString()}>
            {dateTimeFormatter.format(task.dueAt)}
          </time>
        </p>
        {task.completedAt ? (
          <p className="text-muted-foreground text-xs">
            Completed {dateTimeFormatter.format(task.completedAt)}
          </p>
        ) : null}
      </div>
      {archived ? null : (
        <TaskStatusButton
          status={task.status}
          taskId={task.id}
          taskTitle={task.title}
        />
      )}
    </div>
    {archived ? null : (
      <details className="mt-3 border-t pt-3">
        <summary
          aria-label={`Edit task: ${task.title}`}
          className="w-fit cursor-pointer text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
        >
          Edit task
        </summary>
        <div className="mt-4 rounded-lg bg-muted/25 p-4">
          <TaskForm
            initial={{
              dueAt: task.dueAt,
              priority: task.priority,
              title: task.title,
            }}
            mode="edit"
            taskId={task.id}
          />
        </div>
      </details>
    )}
  </article>
);

const TaskSection = ({
  archived,
  tasks,
  title,
}: {
  archived: boolean;
  tasks: Task[];
  title: string;
}) => (
  <section aria-labelledby={`prospect-${title.toLowerCase()}-tasks`}>
    <div className="mb-3 flex items-center justify-between border-b pb-2">
      <h3
        className="font-medium text-sm"
        id={`prospect-${title.toLowerCase()}-tasks`}
      >
        {title}
      </h3>
      <span className="font-mono text-muted-foreground text-xs tabular-nums">
        {tasks.length}
      </span>
    </div>
    {tasks.length === 0 ? (
      <p className="rounded-lg border border-dashed p-5 text-center text-muted-foreground text-sm">
        No {title.toLowerCase()} tasks.
      </p>
    ) : (
      <div className="space-y-3">
        {tasks.map((task) => (
          <TaskItem archived={archived} key={task.id} task={task} />
        ))}
      </div>
    )}
  </section>
);

export const TaskList = ({
  archived,
  completedTasks,
  openTasks,
}: {
  archived: boolean;
  completedTasks: Task[];
  openTasks: Task[];
}) => (
  <div className="grid gap-6 lg:grid-cols-2">
    <TaskSection archived={archived} tasks={openTasks} title="Open" />
    <TaskSection archived={archived} tasks={completedTasks} title="Completed" />
  </div>
);

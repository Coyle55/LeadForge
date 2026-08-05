import type { PipelineStage } from "@repo/database";
import {
  CalendarClock,
  CircleDollarSign,
  ExternalLink,
  ListTodo,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { MoveStageForm } from "./move-stage-form";
import type { PipelineCard as PipelineCardData } from "./queries";

const LEADING_WWW_PATTERN = /^www\./;

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const dueDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

const getHostname = (websiteUrl: string | null) => {
  if (!websiteUrl) {
    return "No website";
  }
  try {
    return new URL(websiteUrl).hostname.replace(LEADING_WWW_PATTERN, "");
  } catch {
    return websiteUrl;
  }
};

const formatDealValue = (valueCents: number | null) =>
  valueCents === null ? "Not set" : currencyFormatter.format(valueCents / 100);

export const PipelineCard = ({
  card,
  stage,
}: {
  card: PipelineCardData;
  stage: PipelineStage;
}) => (
  <article className="group overflow-hidden rounded-lg border bg-card shadow-xs transition-[border-color,box-shadow] hover:border-foreground/20 hover:shadow-sm">
    <div className="space-y-3 p-3.5">
      <div className="min-w-0">
        <Link
          className="inline-flex max-w-full items-center gap-1.5 font-semibold text-sm leading-tight tracking-tight outline-none hover:text-emerald-700 focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-emerald-400"
          href={`/prospects/${card.id}`}
        >
          <span className="truncate">{card.businessName}</span>
          <ExternalLink
            aria-hidden="true"
            className="size-3 shrink-0 opacity-0 transition-opacity group-focus-within:opacity-60 group-hover:opacity-60"
          />
        </Link>
        <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
          {getHostname(card.websiteUrl)}
        </p>
      </div>

      <div className="space-y-2 border-y py-2.5 text-xs">
        <p className="flex items-center gap-2 text-muted-foreground">
          <UserRound aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="truncate">
            {card.contactName ?? "No contact named"}
          </span>
        </p>
        <div className="grid grid-cols-2 gap-x-2 gap-y-2">
          <p className="flex min-w-0 items-center gap-1.5">
            <ListTodo
              aria-hidden="true"
              className="size-3.5 shrink-0 text-muted-foreground"
            />
            <span className="truncate tabular-nums">
              {card.openTaskCount} open
            </span>
          </p>
          <p className="flex min-w-0 items-center gap-1.5">
            <CalendarClock
              aria-hidden="true"
              className="size-3.5 shrink-0 text-muted-foreground"
            />
            {card.nearestTaskDueAt ? (
              <time
                className="truncate tabular-nums"
                dateTime={card.nearestTaskDueAt.toISOString()}
              >
                {dueDateFormatter.format(card.nearestTaskDueAt)}
              </time>
            ) : (
              <span className="truncate text-muted-foreground">
                No due date
              </span>
            )}
          </p>
        </div>
        <p className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <CircleDollarSign aria-hidden="true" className="size-3.5" />
            Deal
          </span>
          <span className="font-medium tabular-nums">
            {formatDealValue(card.dealValueCents)}
          </span>
        </p>
      </div>

      <MoveStageForm currentStage={stage} prospectId={card.id} />
    </div>
  </article>
);

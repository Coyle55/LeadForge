import { auth } from "@repo/auth/server";
import type { PipelineStage } from "@repo/database";
import { ArrowRight } from "lucide-react";
import { PipelineCard } from "./pipeline-card";
import { getPipeline, PIPELINE_STAGES } from "./queries";

const stageMeta: Record<
  PipelineStage,
  { accent: string; description: string; label: string }
> = {
  NEW: {
    accent: "bg-slate-400",
    description: "Unworked leads",
    label: "New",
  },
  CONTACTED: {
    accent: "bg-sky-500",
    description: "First touch sent",
    label: "Contacted",
  },
  INTERESTED: {
    accent: "bg-amber-500",
    description: "Active conversations",
    label: "Interested",
  },
  PROPOSAL: {
    accent: "bg-orange-500",
    description: "Offers in review",
    label: "Proposal",
  },
  WON: {
    accent: "bg-emerald-500",
    description: "Closed business",
    label: "Won",
  },
  LOST: {
    accent: "bg-rose-500",
    description: "Closed without sale",
    label: "Lost",
  },
};

const PipelinePage = async () => {
  const { userId } = await auth();
  if (!userId) {
    return null;
  }

  const pipeline = await getPipeline(userId);
  const totalProspects = PIPELINE_STAGES.reduce(
    (total, stage) => total + pipeline[stage].length,
    0
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-medium text-emerald-700 text-xs uppercase tracking-[0.22em] dark:text-emerald-400">
            Sales workspace
          </p>
          <h1 className="mt-1 font-semibold text-3xl tracking-tight">
            Pipeline
          </h1>
          <p className="mt-1 max-w-xl text-muted-foreground text-sm">
            Move prospects deliberately as conversations progress. Every change
            is submitted and confirmed by the server.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3 rounded-lg border bg-card px-3.5 py-2.5 shadow-xs">
          <span className="font-mono font-semibold text-xl tabular-nums">
            {totalProspects}
          </span>
          <span className="text-muted-foreground text-xs leading-tight">
            active
            <br />
            prospects
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 text-muted-foreground text-xs sm:hidden">
        <ArrowRight aria-hidden="true" className="size-3.5" />
        Scroll to see every stage
      </div>

      <section
        aria-label="Sales pipeline stages"
        className="relative left-1/2 flex w-[calc(100vw-3rem)] max-w-[100rem] -translate-x-1/2 snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-5"
      >
        {PIPELINE_STAGES.map((stage) => {
          const meta = stageMeta[stage];
          const cards = pipeline[stage];
          const headingId = `pipeline-stage-${stage.toLowerCase()}`;

          return (
            <section
              aria-labelledby={headingId}
              className="w-[17rem] shrink-0 snap-start"
              key={stage}
            >
              <div className="mb-2.5 flex min-h-11 items-start justify-between gap-3 px-1">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={`size-1.5 rounded-full ${meta.accent}`}
                    />
                    <h2
                      className="font-semibold text-xs uppercase tracking-[0.14em]"
                      id={headingId}
                    >
                      {meta.label}
                    </h2>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {meta.description}
                  </p>
                </div>
                <span className="sr-only">
                  {cards.length} {cards.length === 1 ? "prospect" : "prospects"}
                </span>
                <span
                  aria-hidden="true"
                  className="inline-flex min-w-6 items-center justify-center rounded-full border bg-card px-1.5 py-0.5 font-mono text-[11px] tabular-nums"
                >
                  {cards.length}
                </span>
              </div>

              <div className="min-h-40 space-y-3 rounded-xl border border-dashed bg-muted/20 p-2.5">
                {cards.length === 0 ? (
                  <div className="flex min-h-32 items-center justify-center rounded-lg border border-dashed bg-background/40 px-5 text-center text-muted-foreground text-xs">
                    No prospects at this stage
                  </div>
                ) : (
                  cards.map((card) => (
                    <PipelineCard card={card} key={card.id} stage={stage} />
                  ))
                )}
              </div>
            </section>
          );
        })}
      </section>
    </div>
  );
};

export default PipelinePage;

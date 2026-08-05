import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./move-stage-form", () => ({ MoveStageForm: () => null }));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("PipelineCard", () => {
  it("renders a UTC-next-day task on the New York calendar date", async () => {
    vi.stubEnv("TZ", "UTC");
    const { PipelineCard } = await import("./pipeline-card");

    render(
      <PipelineCard
        card={{
          businessName: "Acme Plumbing",
          contactName: "Ada",
          dealValueCents: null,
          id: "prospect_1",
          nearestTaskDueAt: new Date("2026-08-05T03:30:00.000Z"),
          openTaskCount: 1,
          websiteUrl: "https://acme.example",
        }}
        stage="NEW"
      />
    );

    expect(screen.getByText("Aug 4")).toBeTruthy();
    expect(screen.queryByText("Aug 5")).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const prospectFindManyMock = vi.fn();
const prospectFindFirstMock = vi.fn();
const dealFindManyMock = vi.fn();
const dealFindFirstMock = vi.fn();
const taskFindManyMock = vi.fn();

vi.mock("@repo/database", () => ({
  database: {
    deal: { findFirst: dealFindFirstMock, findMany: dealFindManyMock },
    prospect: {
      findFirst: prospectFindFirstMock,
      findMany: prospectFindManyMock,
    },
    task: { findMany: taskFindManyMock },
  },
}));

describe("pipeline queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prospectFindManyMock.mockResolvedValue([]);
    prospectFindFirstMock.mockResolvedValue(null);
    dealFindManyMock.mockResolvedValue([]);
    dealFindFirstMock.mockResolvedValue(null);
    taskFindManyMock.mockResolvedValue([]);
  });

  it("returns every fixed stage even when the active pipeline is empty", async () => {
    const { getPipeline } = await import("./queries");

    await expect(getPipeline("user_owner")).resolves.toEqual({
      CONTACTED: [],
      INTERESTED: [],
      LOST: [],
      NEW: [],
      PROPOSAL: [],
      WON: [],
    });
    expect(prospectFindManyMock).toHaveBeenCalledWith({
      select: {
        businessName: true,
        contactName: true,
        id: true,
        pipelineStage: true,
        updatedAt: true,
        websiteUrl: true,
      },
      where: { archivedAt: null, userId: "user_owner" },
    });
  });

  it("batches owner-scoped Deals and open Tasks and exposes only card fields", async () => {
    const prospectUpdatedAt = new Date("2026-08-04T15:00:00.000Z");
    const nearestTaskDueAt = new Date("2026-08-05T13:00:00.000Z");
    prospectFindManyMock.mockResolvedValue([
      {
        businessName: "Acme Plumbing",
        contactName: "Ada",
        id: "prospect_1",
        pipelineStage: "PROPOSAL",
        updatedAt: prospectUpdatedAt,
        websiteUrl: "https://acme.example/private/path",
        contactEmail: "must-not-leak@example.com",
        notes: "must not leak",
        userId: "user_owner",
      },
      {
        businessName: "Beta Electric",
        contactName: null,
        id: "prospect_2",
        pipelineStage: "NEW",
        updatedAt: new Date("2026-08-03T15:00:00.000Z"),
        websiteUrl: null,
      },
    ]);
    dealFindManyMock.mockResolvedValue([
      {
        actualCloseDate: new Date("2026-08-01T12:00:00.000Z"),
        id: "deal_1",
        lossReason: "must not leak",
        prospectId: "prospect_1",
        valueCents: 125_000,
      },
    ]);
    taskFindManyMock.mockResolvedValue([
      {
        dueAt: new Date("2026-08-07T13:00:00.000Z"),
        id: "task_later",
        prospectId: "prospect_1",
        title: "must not leak",
      },
      {
        dueAt: nearestTaskDueAt,
        id: "task_nearest",
        prospectId: "prospect_1",
        title: "must not leak",
      },
    ]);
    const { getPipeline } = await import("./queries");

    const pipeline = await getPipeline("user_owner");

    expect(dealFindManyMock).toHaveBeenCalledWith({
      select: { prospectId: true, valueCents: true },
      where: {
        prospectId: { in: ["prospect_1", "prospect_2"] },
        userId: "user_owner",
      },
    });
    expect(taskFindManyMock).toHaveBeenCalledWith({
      select: { dueAt: true, prospectId: true },
      where: {
        prospectId: { in: ["prospect_1", "prospect_2"] },
        status: "OPEN",
        userId: "user_owner",
      },
    });
    expect(pipeline.PROPOSAL).toEqual([
      {
        businessName: "Acme Plumbing",
        contactName: "Ada",
        dealValueCents: 125_000,
        id: "prospect_1",
        nearestTaskDueAt,
        openTaskCount: 2,
        websiteUrl: "https://acme.example/private/path",
      },
    ]);
    expect(pipeline.NEW).toEqual([
      {
        businessName: "Beta Electric",
        contactName: null,
        dealValueCents: null,
        id: "prospect_2",
        nearestTaskDueAt: null,
        openTaskCount: 0,
        websiteUrl: null,
      },
    ]);
  });

  it("orders cards by nearest task, updated time descending, then ID", async () => {
    const sameDueAt = new Date("2026-08-06T13:00:00.000Z");
    const sameUpdatedAt = new Date("2026-08-04T16:00:00.000Z");
    prospectFindManyMock.mockResolvedValue([
      {
        businessName: "No task",
        contactName: null,
        id: "prospect_none",
        pipelineStage: "INTERESTED",
        updatedAt: new Date("2026-08-04T18:00:00.000Z"),
        websiteUrl: null,
      },
      {
        businessName: "B",
        contactName: null,
        id: "prospect_b",
        pipelineStage: "INTERESTED",
        updatedAt: sameUpdatedAt,
        websiteUrl: null,
      },
      {
        businessName: "Nearest",
        contactName: null,
        id: "prospect_nearest",
        pipelineStage: "INTERESTED",
        updatedAt: new Date("2026-08-01T16:00:00.000Z"),
        websiteUrl: null,
      },
      {
        businessName: "A",
        contactName: null,
        id: "prospect_a",
        pipelineStage: "INTERESTED",
        updatedAt: sameUpdatedAt,
        websiteUrl: null,
      },
      {
        businessName: "Older update",
        contactName: null,
        id: "prospect_older",
        pipelineStage: "INTERESTED",
        updatedAt: new Date("2026-08-03T16:00:00.000Z"),
        websiteUrl: null,
      },
    ]);
    taskFindManyMock.mockResolvedValue([
      {
        dueAt: sameDueAt,
        prospectId: "prospect_older",
      },
      {
        dueAt: new Date("2026-08-05T13:00:00.000Z"),
        prospectId: "prospect_nearest",
      },
      { dueAt: sameDueAt, prospectId: "prospect_b" },
      { dueAt: sameDueAt, prospectId: "prospect_a" },
    ]);
    const { getPipeline } = await import("./queries");

    const pipeline = await getPipeline("user_owner");

    expect(pipeline.INTERESTED.map(({ id }) => id)).toEqual([
      "prospect_nearest",
      "prospect_a",
      "prospect_b",
      "prospect_older",
      "prospect_none",
    ]);
  });

  it("returns one owned prospect with an independently owner-scoped Deal", async () => {
    const archivedAt = new Date("2026-08-01T12:00:00.000Z");
    const deal = {
      actualCloseDate: null,
      expectedCloseDate: new Date("2026-09-15T12:00:00.000Z"),
      lossReason: null,
      valueCents: 125_000,
    };
    prospectFindFirstMock.mockResolvedValue({
      archivedAt,
      id: "prospect_1",
      pipelineStage: "PROPOSAL",
    });
    dealFindFirstMock.mockResolvedValue(deal);
    const { getProspectPipelineDetail } = await import("./queries");

    await expect(
      getProspectPipelineDetail("user_owner", "prospect_1")
    ).resolves.toEqual({
      archivedAt,
      deal,
      id: "prospect_1",
      pipelineStage: "PROPOSAL",
    });
    expect(prospectFindFirstMock).toHaveBeenCalledWith({
      select: { archivedAt: true, id: true, pipelineStage: true },
      where: { id: "prospect_1", userId: "user_owner" },
    });
    expect(dealFindFirstMock).toHaveBeenCalledWith({
      select: {
        actualCloseDate: true,
        expectedCloseDate: true,
        lossReason: true,
        valueCents: true,
      },
      where: { prospectId: "prospect_1", userId: "user_owner" },
    });
  });

  it("returns null without querying Deals when the owned prospect is absent", async () => {
    prospectFindFirstMock.mockResolvedValue(null);
    const { getProspectPipelineDetail } = await import("./queries");

    await expect(
      getProspectPipelineDetail("user_owner", "prospect_other")
    ).resolves.toBeNull();
    expect(dealFindFirstMock).not.toHaveBeenCalled();
  });

  it("returns a null Deal for an owned prospect without one", async () => {
    prospectFindFirstMock.mockResolvedValue({
      archivedAt: null,
      id: "prospect_1",
      pipelineStage: "INTERESTED",
    });
    dealFindFirstMock.mockResolvedValue(null);
    const { getProspectPipelineDetail } = await import("./queries");

    await expect(
      getProspectPipelineDetail("user_owner", "prospect_1")
    ).resolves.toEqual({
      archivedAt: null,
      deal: null,
      id: "prospect_1",
      pipelineStage: "INTERESTED",
    });
  });
});

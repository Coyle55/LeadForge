import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const transactionMock = vi.fn();
const prospectFindFirstMock = vi.fn();
const prospectUpdateManyMock = vi.fn();
const dealFindFirstMock = vi.fn();
const dealCreateMock = vi.fn();
const dealUpdateManyMock = vi.fn();
const taskCreateMock = vi.fn();
const taskUpdateManyMock = vi.fn();
const logInfoMock = vi.fn();
const logErrorMock = vi.fn();
const revalidatePathMock = vi.fn();

const transaction = {
  deal: {
    create: dealCreateMock,
    findFirst: dealFindFirstMock,
    updateMany: dealUpdateManyMock,
  },
  prospect: {
    findFirst: prospectFindFirstMock,
    updateMany: prospectUpdateManyMock,
  },
  task: { create: taskCreateMock, updateMany: taskUpdateManyMock },
};

vi.mock("@repo/auth/server", () => ({ auth: authMock }));
vi.mock("@repo/auth", () => ({
  isAllowedUserId: (userId: string) => userId === "user_owner",
}));
vi.mock("@repo/database", () => ({
  database: {
    $transaction: transactionMock,
    task: { create: taskCreateMock, updateMany: taskUpdateManyMock },
  },
}));
vi.mock("@repo/observability", () => ({
  logger: { error: logErrorMock, info: logInfoMock },
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    data.set(key, value);
  }
  return data;
};

const revalidatedPaths = () =>
  revalidatePathMock.mock.calls.map(([path]) => path);

const prismaError = (code: "P2002" | "P2034", message: string) =>
  Object.assign(new Error(message), { code });

describe("pipeline and Deal actions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.ALLOWED_USER_IDS = "user_owner";
    transactionMock.mockImplementation(
      async (callback: (client: typeof transaction) => unknown) =>
        await callback(transaction)
    );
    prospectFindFirstMock.mockResolvedValue({
      id: "prospect_1",
      pipelineStage: "PROPOSAL",
    });
    prospectUpdateManyMock.mockResolvedValue({ count: 1 });
    dealFindFirstMock.mockResolvedValue({
      actualCloseDate: new Date("2026-08-04T12:00:00.000Z"),
      id: "deal_1",
      lossReason: null,
      valueCents: 125_000,
    });
    dealCreateMock.mockResolvedValue({ id: "deal_1" });
    dealUpdateManyMock.mockResolvedValue({ count: 1 });
  });

  it("authorizes both actions before reading form input or opening a transaction", async () => {
    authMock
      .mockResolvedValueOnce({ userId: null })
      .mockResolvedValueOnce({ userId: "user_other" });
    const unreadableForm = {
      get: () => {
        throw new Error("form input was read");
      },
    } as unknown as FormData;
    const { moveProspectStage, saveDeal } = await import("./pipeline");

    await expect(moveProspectStage({}, unreadableForm)).resolves.toEqual({
      message: "Not authorized.",
      status: "error",
    });
    await expect(saveDeal({}, unreadableForm)).resolves.toEqual({
      message: "Not authorized.",
      status: "error",
    });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      values: { destination: "QUALIFIED", prospectId: "prospect_1" },
      field: "destination",
    },
    {
      values: {
        actualCloseDate: "2026-08-04",
        destination: "WON",
        prospectId: "prospect_1",
        value: "",
      },
      field: "value",
    },
    {
      values: {
        destination: "LOST",
        lossReason: " ",
        prospectId: "prospect_1",
      },
      field: "lossReason",
    },
  ] as {
    field: string;
    values: Record<string, string>;
  }[])("rejects malformed transition input before persistence", async ({
    values,
    field,
  }) => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    const { moveProspectStage } = await import("./pipeline");

    const result = await moveProspectStage({}, form(values));

    expect(result).toMatchObject({
      fieldErrors: { [field]: expect.any(Array) },
      message: "Check the highlighted fields.",
      status: "error",
    });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("moves to Won atomically using only trusted closing fields and owner predicates", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    const { moveProspectStage } = await import("./pipeline");

    await expect(
      moveProspectStage(
        {},
        form({
          actualCloseDate: "2026-08-04",
          completedAt: "2026-01-01T00:00:00.000Z",
          currentStage: "NEW",
          dealId: "deal_victim",
          destination: "WON",
          expectedCloseDate: "2030-01-01",
          lossReason: "forged reason",
          prospectId: "prospect_1",
          taskId: "task_victim",
          userId: "user_victim",
          value: "1250.50",
        })
      )
    ).resolves.toEqual({
      message: "Prospect moved to Won.",
      status: "success",
    });

    expect(transactionMock).toHaveBeenCalledOnce();
    expect(transactionMock).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(prospectFindFirstMock).toHaveBeenCalledWith({
      select: { id: true, pipelineStage: true },
      where: {
        archivedAt: null,
        id: "prospect_1",
        userId: "user_owner",
      },
    });
    expect(dealFindFirstMock).toHaveBeenCalledWith({
      select: { id: true },
      where: { prospectId: "prospect_1", userId: "user_owner" },
    });
    expect(dealUpdateManyMock).toHaveBeenCalledWith({
      data: {
        actualCloseDate: new Date("2026-08-04T12:00:00.000Z"),
        lossReason: null,
        valueCents: 125_050,
      },
      where: {
        id: "deal_1",
        prospectId: "prospect_1",
        userId: "user_owner",
      },
    });
    expect(prospectUpdateManyMock).toHaveBeenCalledWith({
      data: { pipelineStage: "WON" },
      where: {
        archivedAt: null,
        id: "prospect_1",
        pipelineStage: "PROPOSAL",
        userId: "user_owner",
      },
    });
    expect(taskCreateMock).not.toHaveBeenCalled();
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
    expect(revalidatedPaths()).toEqual([
      "/pipeline",
      "/prospects/prospect_1",
      "/prospects",
      "/",
    ]);
  });

  it("creates a Deal inside the same transaction when Won has no Deal", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    dealFindFirstMock.mockResolvedValue(null);
    const { moveProspectStage } = await import("./pipeline");

    await moveProspectStage(
      {},
      form({
        actualCloseDate: "2026-08-05",
        destination: "WON",
        prospectId: "prospect_1",
        value: "800",
      })
    );

    expect(dealCreateMock).toHaveBeenCalledWith({
      data: {
        actualCloseDate: new Date("2026-08-05T12:00:00.000Z"),
        lossReason: null,
        prospectId: "prospect_1",
        userId: "user_owner",
        valueCents: 80_000,
      },
      select: { id: true },
    });
    expect(prospectUpdateManyMock).toHaveBeenCalledOnce();
  });

  it("moves to Lost without trusting a forged value and clears the Won close date", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    const { moveProspectStage } = await import("./pipeline");

    await moveProspectStage(
      {},
      form({
        actualCloseDate: "2029-01-01",
        destination: "LOST",
        lossReason: "  Budget moved to next year  ",
        prospectId: "prospect_1",
        value: "1.00",
      })
    );

    expect(dealUpdateManyMock).toHaveBeenCalledWith({
      data: {
        actualCloseDate: null,
        lossReason: "Budget moved to next year",
      },
      where: {
        id: "deal_1",
        prospectId: "prospect_1",
        userId: "user_owner",
      },
    });
  });

  it("clears both terminal fields away from Won and Lost while retaining non-terminal Deal data", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    const { moveProspectStage } = await import("./pipeline");

    await moveProspectStage(
      {},
      form({
        actualCloseDate: "2029-01-01",
        destination: "CONTACTED",
        expectedCloseDate: "2029-02-01",
        lossReason: "forged reason",
        prospectId: "prospect_1",
        value: "1.00",
      })
    );

    expect(dealUpdateManyMock).toHaveBeenCalledWith({
      data: { actualCloseDate: null, lossReason: null },
      where: {
        id: "deal_1",
        prospectId: "prospect_1",
        userId: "user_owner",
      },
    });
    expect(dealCreateMock).not.toHaveBeenCalled();
  });

  it("does not manufacture an empty Deal for a non-closing stage", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    dealFindFirstMock.mockResolvedValue(null);
    const { moveProspectStage } = await import("./pipeline");

    await expect(
      moveProspectStage(
        {},
        form({ destination: "INTERESTED", prospectId: "prospect_1" })
      )
    ).resolves.toMatchObject({ status: "success" });

    expect(dealCreateMock).not.toHaveBeenCalled();
    expect(dealUpdateManyMock).not.toHaveBeenCalled();
    expect(prospectUpdateManyMock).toHaveBeenCalledOnce();
  });

  it("returns one not-found result for missing, archived, or cross-owner prospects", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    prospectFindFirstMock.mockResolvedValue(null);
    const { moveProspectStage } = await import("./pipeline");

    await expect(
      moveProspectStage(
        {},
        form({ destination: "PROPOSAL", prospectId: "prospect_other" })
      )
    ).resolves.toEqual({
      message: "Prospect not found.",
      status: "error",
    });
    expect(dealFindFirstMock).not.toHaveBeenCalled();
    expect(prospectUpdateManyMock).not.toHaveBeenCalled();
  });

  it("fails the whole transition when an owner-scoped affected-row check loses a race", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    prospectUpdateManyMock.mockResolvedValue({ count: 0 });
    const { moveProspectStage } = await import("./pipeline");

    await expect(
      moveProspectStage(
        {},
        form({ destination: "PROPOSAL", prospectId: "prospect_1" })
      )
    ).resolves.toEqual({
      message: "Prospect not found.",
      status: "error",
    });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("does not write the stage when the owner-scoped Deal update affects no row", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    dealUpdateManyMock.mockResolvedValue({ count: 0 });
    const { moveProspectStage } = await import("./pipeline");

    await expect(
      moveProspectStage(
        {},
        form({ destination: "PROPOSAL", prospectId: "prospect_1" })
      )
    ).resolves.toEqual({
      message: "Prospect not found.",
      status: "error",
    });
    expect(prospectUpdateManyMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("logs only safe transition metadata when persistence fails", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    transactionMock.mockRejectedValue(
      new Error("database password leaked with private loss reason")
    );
    const { moveProspectStage } = await import("./pipeline");

    await expect(
      moveProspectStage(
        {},
        form({
          destination: "LOST",
          lossReason: "Private customer context",
          prospectId: "prospect_1",
        })
      )
    ).resolves.toEqual({
      message: "Unable to move prospect.",
      status: "error",
    });
    expect(logErrorMock).toHaveBeenCalledWith("pipeline.mutation.failed", {
      action: "move",
      code: "DATABASE_ERROR",
      destination: "LOST",
      prospectId: "prospect_1",
      userId: "user_owner",
    });
    const logs = JSON.stringify(logErrorMock.mock.calls);
    expect(logs).not.toContain("Private customer");
    expect(logs).not.toContain("password");
  });

  it("keeps a committed transition successful when logging and cache revalidation fail", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    logInfoMock.mockImplementationOnce(() => {
      throw new Error("logger internals leaked");
    });
    revalidatePathMock.mockImplementationOnce(() => {
      throw new Error("cache internals leaked");
    });
    const { moveProspectStage } = await import("./pipeline");

    await expect(
      moveProspectStage(
        {},
        form({ destination: "PROPOSAL", prospectId: "prospect_1" })
      )
    ).resolves.toEqual({
      message: "Prospect moved to Proposal.",
      status: "success",
    });
    expect(transactionMock).toHaveBeenCalledOnce();
    expect(revalidatedPaths()).toEqual([
      "/pipeline",
      "/prospects/prospect_1",
      "/prospects",
      "/",
    ]);
    expect(logErrorMock).toHaveBeenCalledWith("pipeline.observability.failed", {
      action: "move",
      code: "LOGGING_ERROR",
      destination: "PROPOSAL",
      prospectId: "prospect_1",
      userId: "user_owner",
    });
    expect(logErrorMock).toHaveBeenCalledWith("pipeline.revalidation.failed", {
      action: "move",
      code: "CACHE_REVALIDATION_ERROR",
      destination: "PROPOSAL",
      prospectId: "prospect_1",
      userId: "user_owner",
    });
    expect(JSON.stringify(logErrorMock.mock.calls)).not.toContain("internals");
  });

  it("retries a serialization conflict before committing one transition", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    let attempts = 0;
    transactionMock.mockImplementation(
      async (callback: (client: typeof transaction) => unknown) => {
        attempts += 1;
        if (attempts === 1) {
          throw prismaError(
            "P2034",
            "transaction serialization details leaked"
          );
        }
        return await callback(transaction);
      }
    );
    const { moveProspectStage } = await import("./pipeline");

    await expect(
      moveProspectStage(
        {},
        form({ destination: "PROPOSAL", prospectId: "prospect_1" })
      )
    ).resolves.toEqual({
      message: "Prospect moved to Proposal.",
      status: "success",
    });
    expect(transactionMock).toHaveBeenCalledTimes(2);
    expect(logInfoMock).toHaveBeenCalledOnce();
    expect(revalidatedPaths()).toEqual([
      "/pipeline",
      "/prospects/prospect_1",
      "/prospects",
      "/",
    ]);
    expect(JSON.stringify(logErrorMock.mock.calls)).not.toContain(
      "serialization details"
    );
  });

  it("returns one safe transition failure after bounded retry exhaustion", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    transactionMock.mockImplementation(() =>
      Promise.reject(
        prismaError("P2034", "transaction serialization details leaked")
      )
    );
    const { moveProspectStage } = await import("./pipeline");

    await expect(
      moveProspectStage(
        {},
        form({ destination: "PROPOSAL", prospectId: "prospect_1" })
      )
    ).resolves.toEqual({
      message: "Unable to move prospect.",
      status: "error",
    });
    expect(transactionMock).toHaveBeenCalledTimes(3);
    expect(logInfoMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
    expect(logErrorMock).toHaveBeenCalledOnce();
    expect(JSON.stringify(logErrorMock.mock.calls)).not.toContain(
      "serialization details"
    );
  });

  it("saves only editable Deal fields for an owned active eligible prospect", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    prospectFindFirstMock.mockResolvedValue({
      id: "prospect_1",
      pipelineStage: "WON",
    });
    const { saveDeal } = await import("./pipeline");

    await expect(
      saveDeal(
        {},
        form({
          actualCloseDate: "2030-01-01",
          dealId: "deal_victim",
          expectedCloseDate: "2026-09-15",
          lossReason: "forged reason",
          pipelineStage: "INTERESTED",
          prospectId: "prospect_1",
          taskId: "task_victim",
          userId: "user_victim",
          value: " 2400.75 ",
        })
      )
    ).resolves.toEqual({ message: "Deal saved.", status: "success" });

    expect(transactionMock).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(prospectFindFirstMock).toHaveBeenCalledWith({
      select: { id: true, pipelineStage: true },
      where: {
        archivedAt: null,
        id: "prospect_1",
        userId: "user_owner",
      },
    });
    expect(dealFindFirstMock).toHaveBeenCalledWith({
      select: {
        actualCloseDate: true,
        id: true,
        lossReason: true,
        valueCents: true,
      },
      where: { prospectId: "prospect_1", userId: "user_owner" },
    });
    expect(dealUpdateManyMock).toHaveBeenCalledWith({
      data: {
        expectedCloseDate: new Date("2026-09-15T12:00:00.000Z"),
        valueCents: 240_075,
      },
      where: {
        id: "deal_1",
        prospectId: "prospect_1",
        userId: "user_owner",
      },
    });
    expect(taskCreateMock).not.toHaveBeenCalled();
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
  });

  it("upserts nullable Deal values by the trusted prospect relationship", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    prospectFindFirstMock.mockResolvedValue({
      id: "prospect_1",
      pipelineStage: "INTERESTED",
    });
    dealFindFirstMock.mockResolvedValue(null);
    const { saveDeal } = await import("./pipeline");

    await saveDeal(
      {},
      form({ expectedCloseDate: "", prospectId: "prospect_1", value: "" })
    );

    expect(dealCreateMock).toHaveBeenCalledWith({
      data: {
        expectedCloseDate: null,
        prospectId: "prospect_1",
        userId: "user_owner",
        valueCents: null,
      },
      select: { id: true },
    });
  });

  it("rejects a blank value that would invalidate an existing Won Deal", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    prospectFindFirstMock.mockResolvedValue({
      id: "prospect_1",
      pipelineStage: "WON",
    });
    dealFindFirstMock.mockResolvedValue({
      actualCloseDate: new Date("2026-08-04T12:00:00.000Z"),
      id: "deal_1",
      lossReason: null,
      valueCents: 125_000,
    });
    const { saveDeal } = await import("./pipeline");

    await expect(
      saveDeal(
        {},
        form({ expectedCloseDate: "", prospectId: "prospect_1", value: "" })
      )
    ).resolves.toEqual({
      message: "Deal closing details are incomplete.",
      status: "error",
    });
    expect(dealUpdateManyMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("does not create a Won Deal without an actual close date", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    prospectFindFirstMock.mockResolvedValue({
      id: "prospect_1",
      pipelineStage: "WON",
    });
    dealFindFirstMock.mockResolvedValue(null);
    const { saveDeal } = await import("./pipeline");

    await expect(
      saveDeal(
        {},
        form({
          expectedCloseDate: "2026-09-15",
          prospectId: "prospect_1",
          value: "500",
        })
      )
    ).resolves.toEqual({
      message: "Deal closing details are incomplete.",
      status: "error",
    });
    expect(dealCreateMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("does not create or update a Lost Deal without a loss reason", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    prospectFindFirstMock.mockResolvedValue({
      id: "prospect_1",
      pipelineStage: "LOST",
    });
    dealFindFirstMock.mockResolvedValue({
      actualCloseDate: null,
      id: "deal_1",
      lossReason: null,
      valueCents: 125_000,
    });
    const { saveDeal } = await import("./pipeline");

    await expect(
      saveDeal(
        {},
        form({
          expectedCloseDate: "2026-09-15",
          prospectId: "prospect_1",
          value: "500",
        })
      )
    ).resolves.toEqual({
      message: "Deal closing details are incomplete.",
      status: "error",
    });
    expect(dealUpdateManyMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("retries a first-create unique conflict and succeeds through the update path", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    prospectFindFirstMock.mockResolvedValue({
      id: "prospect_1",
      pipelineStage: "PROPOSAL",
    });
    let dealLoads = 0;
    dealFindFirstMock.mockImplementation(() => {
      dealLoads += 1;
      return Promise.resolve(
        dealLoads === 1
          ? null
          : {
              actualCloseDate: null,
              id: "deal_concurrent",
              lossReason: null,
              valueCents: null,
            }
      );
    });
    dealCreateMock.mockImplementation(() =>
      Promise.reject(prismaError("P2002", "unique constraint target leaked"))
    );
    const { saveDeal } = await import("./pipeline");

    await expect(
      saveDeal(
        {},
        form({
          expectedCloseDate: "2026-09-15",
          prospectId: "prospect_1",
          value: "500",
        })
      )
    ).resolves.toEqual({ message: "Deal saved.", status: "success" });
    expect(transactionMock).toHaveBeenCalledTimes(2);
    expect(dealCreateMock).toHaveBeenCalledOnce();
    expect(dealUpdateManyMock).toHaveBeenCalledOnce();
    expect(logInfoMock).toHaveBeenCalledOnce();
    expect(revalidatedPaths()).toEqual([
      "/pipeline",
      "/prospects/prospect_1",
      "/prospects",
      "/",
    ]);
    expect(JSON.stringify(logErrorMock.mock.calls)).not.toContain(
      "constraint target"
    );
  });

  it("returns one safe Deal failure after bounded retry exhaustion", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    transactionMock.mockImplementation(() =>
      Promise.reject(
        prismaError("P2034", "transaction serialization details leaked")
      )
    );
    const { saveDeal } = await import("./pipeline");

    await expect(
      saveDeal(
        {},
        form({ expectedCloseDate: "", prospectId: "prospect_1", value: "" })
      )
    ).resolves.toEqual({
      message: "Unable to save deal.",
      status: "error",
    });
    expect(transactionMock).toHaveBeenCalledTimes(3);
    expect(logInfoMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
    expect(logErrorMock).toHaveBeenCalledOnce();
    expect(JSON.stringify(logErrorMock.mock.calls)).not.toContain(
      "serialization details"
    );
  });

  it("blocks Deal editing outside the four active Deal stages", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    prospectFindFirstMock.mockResolvedValue({
      id: "prospect_1",
      pipelineStage: "CONTACTED",
    });
    const { saveDeal } = await import("./pipeline");

    await expect(
      saveDeal(
        {},
        form({ expectedCloseDate: "", prospectId: "prospect_1", value: "" })
      )
    ).resolves.toEqual({
      message: "Deal editing is not available at this stage.",
      status: "error",
    });
    expect(dealFindFirstMock).not.toHaveBeenCalled();
    expect(dealCreateMock).not.toHaveBeenCalled();
    expect(dealUpdateManyMock).not.toHaveBeenCalled();
  });

  it("rejects malformed Deal edits before opening a transaction", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    const { saveDeal } = await import("./pipeline");

    const result = await saveDeal(
      {},
      form({
        expectedCloseDate: "2026-02-30",
        prospectId: "prospect_1",
        value: "12.345",
      })
    );

    expect(result).toMatchObject({
      fieldErrors: {
        expectedCloseDate: expect.any(Array),
        value: expect.any(Array),
      },
      message: "Check the highlighted fields.",
      status: "error",
    });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("returns safe Deal errors for absent prospects and affected-row races", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    const { saveDeal } = await import("./pipeline");
    const input = form({
      expectedCloseDate: "",
      prospectId: "prospect_1",
      value: "500",
    });

    prospectFindFirstMock.mockResolvedValueOnce(null);
    await expect(saveDeal({}, input)).resolves.toEqual({
      message: "Prospect not found.",
      status: "error",
    });

    prospectFindFirstMock.mockResolvedValueOnce({
      id: "prospect_1",
      pipelineStage: "PROPOSAL",
    });
    dealUpdateManyMock.mockResolvedValueOnce({ count: 0 });
    await expect(saveDeal({}, input)).resolves.toEqual({
      message: "Prospect not found.",
      status: "error",
    });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("returns and logs a sanitized Deal persistence failure", async () => {
    authMock.mockResolvedValue({ userId: "user_owner" });
    transactionMock.mockRejectedValue(
      new Error("database password leaked value 9876")
    );
    const { saveDeal } = await import("./pipeline");

    await expect(
      saveDeal(
        {},
        form({
          expectedCloseDate: "2026-09-15",
          prospectId: "prospect_1",
          value: "9876",
        })
      )
    ).resolves.toEqual({
      message: "Unable to save deal.",
      status: "error",
    });
    expect(logErrorMock).toHaveBeenCalledWith("pipeline.mutation.failed", {
      action: "save_deal",
      code: "DATABASE_ERROR",
      prospectId: "prospect_1",
      userId: "user_owner",
    });
    const logs = JSON.stringify(logErrorMock.mock.calls);
    expect(logs).not.toContain("9876");
    expect(logs).not.toContain("password");
  });
});

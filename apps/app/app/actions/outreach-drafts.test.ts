import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const draftFindFirstMock = vi.fn();
const draftUpdateManyMock = vi.fn();
const loggerErrorMock = vi.fn();
const loggerInfoMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@repo/auth/server", () => ({ auth: authMock }));
vi.mock("@repo/auth", () => ({
  isAllowedUserId: (userId: string) => userId === "user_owner",
}));
vi.mock("@repo/database", () => ({
  database: {
    outreachDraft: {
      findFirst: draftFindFirstMock,
      updateMany: draftUpdateManyMock,
    },
  },
}));
vi.mock("@repo/observability", () => ({
  logger: { error: loggerErrorMock, info: loggerInfoMock },
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

const validValues = {
  body: "Hi Jordan,\n\nI noticed a clear contact path may help visitors reach your team.",
  subject: "A quick thought about Acme",
};

const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    data.set(key, value);
  }
  return data;
};

describe("outreach draft actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "user_owner" });
    draftUpdateManyMock.mockResolvedValue({ count: 1 });
  });

  it("rejects callers outside the authenticated owner allowlist before writing", async () => {
    const { updateOutreachDraft } = await import("./outreach-drafts");
    authMock.mockResolvedValue({ userId: null });

    await expect(
      updateOutreachDraft({}, form({ draftId: "draft_1", ...validValues }))
    ).resolves.toEqual({ status: "error", message: "Not authorized." });
    expect(draftUpdateManyMock).not.toHaveBeenCalled();
  });

  it("saves only the validated working copy on the completed authenticated draft", async () => {
    const { updateOutreachDraft } = await import("./outreach-drafts");

    await expect(
      updateOutreachDraft(
        {},
        form({
          ...validValues,
          body: `  ${validValues.body}  `,
          draftId: "draft_1",
          generatedBody: "Forged immutable body",
          generatedSubject: "Forged immutable subject",
          prospectId: "prospect_other",
          recommendationId: "recommendation_other",
          subject: "  A quick thought about Acme  ",
          userId: "user_other",
        })
      )
    ).resolves.toEqual({ status: "success", message: "Draft saved." });

    expect(draftUpdateManyMock).toHaveBeenCalledWith({
      data: validValues,
      where: {
        id: "draft_1",
        status: "COMPLETED",
        userId: "user_owner",
      },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/outreach");
    expect(revalidatePathMock).toHaveBeenCalledWith("/outreach/draft_1");
    expect(loggerInfoMock).toHaveBeenCalledWith(
      "outreach_draft.update.succeeded",
      { action: "update", draftId: "draft_1", userId: "user_owner" }
    );
  });

  it("returns precise validation feedback without writing malformed values", async () => {
    const { updateOutreachDraft } = await import("./outreach-drafts");

    await expect(
      updateOutreachDraft(
        {},
        form({
          draftId: "draft_1",
          subject: "Valid subject",
          body: "Too short",
        })
      )
    ).resolves.toEqual({
      status: "error",
      message:
        "Subject must be 3-120 characters and body must be 40-2,000 characters.",
    });
    expect(draftUpdateManyMock).not.toHaveBeenCalled();
  });

  it("returns a safe persistence error while logging only action metadata", async () => {
    const persistenceError = new Error("database password leaked");
    draftUpdateManyMock.mockRejectedValue(persistenceError);
    const { updateOutreachDraft } = await import("./outreach-drafts");

    await expect(
      updateOutreachDraft({}, form({ draftId: "draft_1", ...validValues }))
    ).resolves.toEqual({
      status: "error",
      message: "Unable to save outreach draft.",
    });
    expect(loggerErrorMock).toHaveBeenCalledWith(
      "outreach_draft.update.failed",
      {
        action: "update",
        draftId: "draft_1",
        error: persistenceError,
        userId: "user_owner",
      }
    );
  });

  it("resets a completed owner draft from stored immutable values only", async () => {
    draftFindFirstMock.mockResolvedValue({
      generatedBody: "Hi Jordan,\n\nStored generation stays authoritative.",
      generatedSubject: "Stored generated subject",
    });
    const { resetOutreachDraft } = await import("./outreach-drafts");

    await expect(
      (
        resetOutreachDraft as unknown as (
          draftId: string,
          forgedValues: Record<string, string>
        ) => ReturnType<typeof resetOutreachDraft>
      )("draft_1", {
        generatedBody: "Forged generated body",
        generatedSubject: "Forged generated subject",
      })
    ).resolves.toEqual({ status: "success", message: "Draft reset." });

    expect(draftFindFirstMock).toHaveBeenCalledWith({
      select: { generatedBody: true, generatedSubject: true },
      where: { id: "draft_1", status: "COMPLETED", userId: "user_owner" },
    });
    expect(draftUpdateManyMock).toHaveBeenCalledWith({
      data: {
        body: "Hi Jordan,\n\nStored generation stays authoritative.",
        subject: "Stored generated subject",
      },
      where: { id: "draft_1", status: "COMPLETED", userId: "user_owner" },
    });
    expect(loggerInfoMock).toHaveBeenCalledWith(
      "outreach_draft.update.succeeded",
      { action: "reset", draftId: "draft_1", userId: "user_owner" }
    );
  });

  it("does not reset missing or other-owner drafts", async () => {
    draftFindFirstMock.mockResolvedValue(null);
    const { resetOutreachDraft } = await import("./outreach-drafts");

    await expect(resetOutreachDraft("draft_1")).resolves.toEqual({
      status: "error",
      message: "Not authorized.",
    });
    expect(draftUpdateManyMock).not.toHaveBeenCalled();
  });
});

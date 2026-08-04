import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyMock = vi.fn();
const countMock = vi.fn();

vi.mock("@repo/database", () => ({
  database: { prospect: { count: countMock, findMany: findManyMock } },
}));

describe("prospect queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findManyMock.mockResolvedValue([]);
    countMock.mockResolvedValue(0);
  });

  it("defaults to active prospects on page one", async () => {
    const { getProspects, parseProspectListParams } = await import("./queries");
    const input = parseProspectListParams({});

    expect(input).toEqual({ page: 1, search: undefined, status: "ACTIVE" });
    await getProspects({ userId: "user_owner", ...input });
    expect(findManyMock).toHaveBeenCalledWith({
      where: { userId: "user_owner", status: { in: ["NEW", "QUALIFIED"] } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: 0,
      take: 25,
    });
  });

  it("applies an explicit status and bounded page", async () => {
    const { getProspects, parseProspectListParams } = await import("./queries");
    const input = parseProspectListParams({ page: "3", status: "archived" });

    await getProspects({ userId: "user_owner", ...input });
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user_owner", status: "ARCHIVED" },
        skip: 50,
        take: 25,
      })
    );
    expect(parseProspectListParams({ page: "-2" }).page).toBe(1);
    expect(parseProspectListParams({ page: "nope" }).page).toBe(1);
  });

  it("searches only the owner's supported text fields", async () => {
    const { getProspects } = await import("./queries");

    await getProspects({
      userId: "user_owner",
      search: "Acme",
      status: "ACTIVE",
      page: 1,
    });
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "user_owner",
          status: { in: ["NEW", "QUALIFIED"] },
          OR: [
            { businessName: { contains: "Acme", mode: "insensitive" } },
            { websiteUrl: { contains: "Acme", mode: "insensitive" } },
            { contactName: { contains: "Acme", mode: "insensitive" } },
            { contactEmail: { contains: "Acme", mode: "insensitive" } },
          ],
        },
      })
    );
  });

  it("returns total and page count", async () => {
    findManyMock.mockResolvedValue([{ id: "prospect_1" }]);
    countMock.mockResolvedValue(51);
    const { getProspects } = await import("./queries");

    await expect(
      getProspects({ userId: "user_owner", status: "NEW", page: 1 })
    ).resolves.toEqual({
      prospects: [{ id: "prospect_1" }],
      total: 51,
      pageCount: 3,
    });
  });
});

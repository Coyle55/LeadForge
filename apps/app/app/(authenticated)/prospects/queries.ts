import { database, type Prisma } from "@repo/database";

export const PROSPECT_PAGE_SIZE = 25;

export type ProspectListStatus = "ACTIVE" | "NEW" | "QUALIFIED" | "ARCHIVED";

interface RawProspectListParams {
  page?: string | string[];
  search?: string | string[];
  status?: string | string[];
}

export interface ProspectListInput {
  page: number;
  search?: string;
  status: ProspectListStatus;
}

const first = (value?: string | string[]) =>
  Array.isArray(value) ? value[0] : value;

export const parseProspectListParams = (
  params: RawProspectListParams
): ProspectListInput => {
  const parsedPage = Number.parseInt(first(params.page) ?? "1", 10);
  const rawStatus = first(params.status)?.toUpperCase();
  const status: ProspectListStatus = ["NEW", "QUALIFIED", "ARCHIVED"].includes(
    rawStatus ?? ""
  )
    ? (rawStatus as ProspectListStatus)
    : "ACTIVE";
  const search = first(params.search)?.trim() || undefined;

  return {
    page: Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1,
    search,
    status,
  };
};

export const getProspects = async ({
  userId,
  search,
  status,
  page,
}: ProspectListInput & { userId: string }) => {
  const where: Prisma.ProspectWhereInput = {
    userId,
    status: status === "ACTIVE" ? { in: ["NEW", "QUALIFIED"] } : status,
    ...(search
      ? {
          OR: ["businessName", "websiteUrl", "contactName", "contactEmail"].map(
            (field) => ({
              [field]: { contains: search, mode: "insensitive" as const },
            })
          ),
        }
      : {}),
  };

  const [prospects, total] = await Promise.all([
    database.prospect.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PROSPECT_PAGE_SIZE,
      take: PROSPECT_PAGE_SIZE,
    }),
    database.prospect.count({ where }),
  ]);

  return {
    prospects,
    total,
    pageCount: Math.ceil(total / PROSPECT_PAGE_SIZE),
  };
};

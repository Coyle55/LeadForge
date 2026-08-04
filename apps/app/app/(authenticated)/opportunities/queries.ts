import { database, type Prisma } from "@repo/database";

export const OPPORTUNITY_PAGE_SIZE = 25;
export type OpportunityListStatus = "COMPLETED" | "FAILED";

export const parseOpportunityListParams = (params: {
  page?: string | string[];
  status?: string | string[];
}) => {
  const first = (value?: string | string[]) =>
    Array.isArray(value) ? value[0] : value;
  const parsedPage = Number.parseInt(first(params.page) ?? "1", 10);
  const rawStatus = first(params.status)?.toUpperCase();
  const status: OpportunityListStatus =
    rawStatus === "FAILED" ? "FAILED" : "COMPLETED";

  return {
    page: Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1,
    status,
  };
};

export const getOpportunities = async ({
  userId,
  page,
  status,
}: {
  userId: string;
  page: number;
  status: OpportunityListStatus;
}) => {
  const where: Prisma.OpportunityAnalysisWhereInput = { userId, status };
  const [analyses, total] = await Promise.all([
    database.opportunityAnalysis.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * OPPORTUNITY_PAGE_SIZE,
      take: OPPORTUNITY_PAGE_SIZE,
    }),
    database.opportunityAnalysis.count({ where }),
  ]);
  const prospectIds = [
    ...new Set(analyses.map(({ prospectId }) => prospectId)),
  ];
  const prospects = await database.prospect.findMany({
    where: { userId, id: { in: prospectIds } },
    select: { id: true, businessName: true, websiteUrl: true },
  });
  const prospectById = new Map(
    prospects.map((prospect) => [prospect.id, prospect])
  );

  return {
    analyses: analyses.map((analysis) => ({
      ...analysis,
      prospect: prospectById.get(analysis.prospectId) ?? null,
    })),
    total,
    pageCount: Math.ceil(total / OPPORTUNITY_PAGE_SIZE),
  };
};

export const getOpportunityDetail = async (
  userId: string,
  analysisId: string
) => {
  const analysis = await database.opportunityAnalysis.findFirst({
    where: { id: analysisId, userId },
    include: { recommendations: { orderBy: { position: "asc" } } },
  });
  if (!analysis) {
    return null;
  }
  const [prospect, audit] = await Promise.all([
    database.prospect.findFirst({
      where: { id: analysis.prospectId, userId },
      select: { id: true, businessName: true, websiteUrl: true },
    }),
    database.websiteAudit.findFirst({
      where: { id: analysis.auditId, userId },
      include: { checks: true },
    }),
  ]);
  return { ...analysis, prospect, audit };
};

export const getLatestAuditOpportunity = async (
  userId: string,
  auditId: string
) =>
  await database.opportunityAnalysis.findFirst({
    where: { userId, auditId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

import { database, type Prisma } from "@repo/database";

export const OUTREACH_PAGE_SIZE = 25;

export type OutreachListStatus = "COMPLETED" | "FAILED";

export const parseOutreachListParams = (params: {
  page?: string | string[];
  status?: string | string[];
}) => {
  const first = (value?: string | string[]) =>
    Array.isArray(value) ? value[0] : value;
  const parsedPage = Number.parseInt(first(params.page) ?? "1", 10);
  const rawStatus = first(params.status)?.toUpperCase();
  const status: OutreachListStatus =
    rawStatus === "FAILED" ? "FAILED" : "COMPLETED";

  return {
    page: Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1,
    status,
  };
};

export const getOutreachDrafts = async ({
  userId,
  page,
  status,
}: {
  userId: string;
  page: number;
  status: OutreachListStatus;
}) => {
  const where: Prisma.OutreachDraftWhereInput = { userId, status };
  const [drafts, total] = await Promise.all([
    database.outreachDraft.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * OUTREACH_PAGE_SIZE,
      take: OUTREACH_PAGE_SIZE,
    }),
    database.outreachDraft.count({ where }),
  ]);
  const prospectIds = [...new Set(drafts.map((draft) => draft.prospectId))];
  const prospects = await database.prospect.findMany({
    where: { userId, id: { in: prospectIds } },
    select: { id: true, businessName: true },
  });
  const prospectNames = new Map(
    prospects.map((prospect) => [prospect.id, prospect.businessName])
  );

  return {
    drafts: drafts.map((draft) => ({
      ...draft,
      prospectName: prospectNames.get(draft.prospectId) ?? "Unknown prospect",
    })),
    total,
    pageCount: Math.ceil(total / OUTREACH_PAGE_SIZE),
  };
};

export const getOutreachDraftDetail = async (
  userId: string,
  draftId: string
) => {
  const draft = await database.outreachDraft.findFirst({
    where: { id: draftId, userId },
  });
  if (!draft) {
    return null;
  }

  const recommendation = await database.opportunityRecommendation.findFirst({
    where: {
      id: draft.recommendationId,
      analysis: { id: draft.analysisId, userId },
    },
    select: {
      analysis: { select: { auditId: true } },
      auditCheckKeys: true,
    },
  });
  if (!recommendation) {
    return { ...draft, sourceAudit: null };
  }

  const auditCheckKeys = Array.isArray(recommendation.auditCheckKeys)
    ? recommendation.auditCheckKeys.filter(
        (key): key is string => typeof key === "string"
      )
    : [];
  const audit = await database.websiteAudit.findFirst({
    where: {
      id: recommendation.analysis.auditId,
      userId,
      status: "COMPLETED",
    },
    select: {
      id: true,
      checks: {
        where: { key: { in: auditCheckKeys } },
        select: { key: true, label: true },
      },
    },
  });
  if (!audit) {
    return { ...draft, sourceAudit: null };
  }

  const evidenceByKey = new Map(
    audit.checks.map((check) => [check.key, check])
  );
  return {
    ...draft,
    sourceAudit: {
      id: audit.id,
      evidence: auditCheckKeys.flatMap((key) => {
        const evidence = evidenceByKey.get(key);
        return evidence ? [evidence] : [];
      }),
    },
  };
};

export const getOutreachReadiness = async (
  userId: string,
  prospectId: string
) => {
  const prospect = await database.prospect.findFirst({
    where: { id: prospectId, userId },
    select: { contactName: true, contactEmail: true },
  });
  if (!(prospect?.contactName?.trim() && prospect.contactEmail?.trim())) {
    return { status: "missing_contact" as const };
  }

  const profile = await database.outreachProfile.findUnique({
    where: { userId },
  });
  return {
    status: profile ? ("ready" as const) : ("missing_profile" as const),
  };
};

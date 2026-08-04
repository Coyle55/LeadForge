import { database, type Prisma } from "@repo/database";

export const AUDIT_PAGE_SIZE = 25;
export type AuditListStatus = "ALL" | "COMPLETED" | "FAILED";

export const parseAuditListParams = (params: {
  page?: string | string[];
  status?: string | string[];
}) => {
  const first = (value?: string | string[]) =>
    Array.isArray(value) ? value[0] : value;
  const parsedPage = Number.parseInt(first(params.page) ?? "1", 10);
  const raw = first(params.status)?.toUpperCase();
  const status: AuditListStatus =
    raw === "COMPLETED" || raw === "FAILED" ? raw : "ALL";
  return {
    page: Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1,
    status,
  };
};

export const getAudits = async ({
  userId,
  page,
  status,
}: {
  userId: string;
  page: number;
  status: AuditListStatus;
}) => {
  const where: Prisma.WebsiteAuditWhereInput = {
    userId,
    ...(status === "ALL" ? {} : { status }),
  };
  const [audits, total] = await Promise.all([
    database.websiteAudit.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * AUDIT_PAGE_SIZE,
      take: AUDIT_PAGE_SIZE,
    }),
    database.websiteAudit.count({ where }),
  ]);
  const prospectIds = [...new Set(audits.map((audit) => audit.prospectId))];
  const prospects = await database.prospect.findMany({
    where: { userId, id: { in: prospectIds } },
    select: { id: true, businessName: true },
  });
  const names = new Map(
    prospects.map((prospect) => [prospect.id, prospect.businessName])
  );
  return {
    audits: audits.map((audit) => ({
      ...audit,
      prospectName: names.get(audit.prospectId) ?? "Unknown prospect",
    })),
    total,
    pageCount: Math.ceil(total / AUDIT_PAGE_SIZE),
  };
};

export const getAuditDetail = async (userId: string, auditId: string) => {
  const audit = await database.websiteAudit.findFirst({
    where: { id: auditId, userId },
    include: { checks: true },
  });
  if (!audit) {
    return null;
  }
  const prospect = await database.prospect.findFirst({
    where: { id: audit.prospectId, userId },
    select: { id: true, businessName: true, websiteUrl: true },
  });
  return { ...audit, prospect };
};

export const getLatestProspectAudit = async (
  userId: string,
  prospectId: string
) =>
  await database.websiteAudit.findFirst({
    where: { userId, prospectId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

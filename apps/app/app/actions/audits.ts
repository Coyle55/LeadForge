"use server";

import { runWebsiteAudit } from "@repo/audit-engine";
import { isAllowedUserId } from "@repo/auth";
import { auth } from "@repo/auth/server";
import { database } from "@repo/database";
import { logger } from "@repo/observability";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export interface AuditActionError {
  message: string;
  status: "error";
}

const safeMessages: Record<string, string> = {
  INVALID_TARGET: "The website address is not valid.",
  BLOCKED_TARGET: "The website target is not publicly reachable.",
  ROBOTS_BLOCKED: "The website does not allow this audit crawler.",
  TIMEOUT: "The website audit timed out.",
  UNREACHABLE: "The website could not be reached.",
  INVALID_RESPONSE: "The website returned an unsupported response.",
  RESPONSE_TOO_LARGE: "The website response exceeded the audit limit.",
  INTERNAL_ERROR: "The website audit could not be completed.",
};

export const runProspectAudit = async (
  prospectId: string
): Promise<AuditActionError | undefined> => {
  const { userId } = await auth();
  if (!(userId && isAllowedUserId(userId))) {
    return { status: "error", message: "Not authorized." };
  }
  const prospect = await database.prospect.findFirst({
    where: { id: prospectId, userId },
    select: { id: true, websiteUrl: true },
  });
  if (!prospect) {
    return { status: "error", message: "Prospect not found." };
  }
  if (!prospect.websiteUrl) {
    return {
      status: "error",
      message: "Add a website before running an audit.",
    };
  }
  const recent = await database.websiteAudit.findFirst({
    where: {
      prospectId,
      userId,
      status: "RUNNING",
      createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
    },
    select: { id: true },
  });
  if (recent) {
    redirect(`/audits/${recent.id}`);
    return;
  }
  let audit: { id: string };
  try {
    audit = await database.websiteAudit.create({
      data: { userId, prospectId, requestedUrl: prospect.websiteUrl },
      select: { id: true },
    });
  } catch (error) {
    logger.error("audit.persistence.failed", { userId, prospectId, error });
    return { status: "error", message: "Unable to start website audit." };
  }
  logger.info("audit.run.started", { userId, prospectId, auditId: audit.id });
  try {
    const result = await runWebsiteAudit(prospect.websiteUrl);
    await database.$transaction([
      database.auditCheck.createMany({
        data: result.checks.map((check) => ({ auditId: audit.id, ...check })),
      }),
      database.websiteAudit.update({
        where: { id: audit.id },
        data: {
          status: "COMPLETED",
          finalUrl: result.finalUrl,
          pagesAttempted: result.pagesAttempted,
          pagesAudited: result.pagesAudited,
          durationMs: result.durationMs,
          screenshotUrl:
            result.screenshot.status === "captured"
              ? result.screenshot.url
              : null,
          screenshotStatus: result.screenshot.status,
          completedAt: new Date(),
        },
      }),
    ]);
    logger.info("audit.run.succeeded", {
      userId,
      prospectId,
      auditId: audit.id,
      durationMs: result.durationMs,
      pagesAudited: result.pagesAudited,
    });
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? String(error.code)
        : "INTERNAL_ERROR";
    const failureCode = code in safeMessages ? code : "INTERNAL_ERROR";
    try {
      await database.websiteAudit.update({
        where: { id: audit.id },
        data: {
          status: "FAILED",
          failureCode,
          failureMessage: safeMessages[failureCode],
          completedAt: new Date(),
        },
      });
    } catch (persistenceError) {
      logger.error("audit.persistence.failed", {
        userId,
        prospectId,
        auditId: audit.id,
        error: persistenceError,
      });
      return { status: "error", message: "Unable to save website audit." };
    }
    logger.error("audit.run.failed", {
      userId,
      prospectId,
      auditId: audit.id,
      failureCode,
      error,
    });
  }
  revalidatePath("/audits");
  revalidatePath(`/prospects/${prospectId}`);
  redirect(`/audits/${audit.id}`);
};

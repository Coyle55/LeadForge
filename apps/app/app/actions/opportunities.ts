"use server";

import { isAllowedUserId } from "@repo/auth";
import { auth } from "@repo/auth/server";
import { database } from "@repo/database";
import { logger } from "@repo/observability";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { env } from "../../env";
import { generateOpportunity } from "../lib/opportunity/generate";
import { buildOpportunityInput } from "../lib/opportunity/input";
import { OPPORTUNITY_PROMPT_VERSION } from "../lib/opportunity/prompt";

const failureMessages: Record<string, string> = {
  MODEL_NOT_CONFIGURED: "AI Gateway model configuration is required.",
  GATEWAY_ERROR: "The AI analysis service could not complete this request.",
  RATE_LIMITED: "The AI analysis service is temporarily rate limited.",
  TIMEOUT: "The AI analysis request timed out.",
  INVALID_OUTPUT: "The AI response did not meet the required analysis format.",
  INTERNAL_ERROR: "The opportunity analysis could not be completed.",
};

export const analyzeAuditOpportunity = async (
  auditId: string
): Promise<{ status: "error"; message: string } | undefined> => {
  const { userId } = await auth();
  if (!(userId && isAllowedUserId(userId))) {
    return { status: "error", message: "Not authorized." };
  }
  const audit = await database.websiteAudit.findFirst({
    where: { id: auditId, userId, status: "COMPLETED" },
    include: { checks: true },
  });
  if (!audit) {
    return { status: "error", message: "Completed audit not found." };
  }
  const model = env.AI_GATEWAY_MODEL;
  if (!model) {
    return { status: "error", message: failureMessages.MODEL_NOT_CONFIGURED };
  }
  const prospect = await database.prospect.findFirst({
    where: { id: audit.prospectId, userId },
    select: { businessName: true },
  });
  if (!prospect) {
    return { status: "error", message: "Completed audit not found." };
  }
  const recent = await database.opportunityAnalysis.findFirst({
    where: {
      auditId,
      userId,
      status: "RUNNING",
      createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
    },
    select: { id: true },
  });
  if (recent) {
    redirect(`/opportunities/${recent.id}`);
    return;
  }
  let analysis: { id: string };
  try {
    analysis = await database.opportunityAnalysis.create({
      data: {
        userId,
        auditId,
        prospectId: audit.prospectId,
        model,
        promptVersion: OPPORTUNITY_PROMPT_VERSION,
      },
      select: { id: true },
    });
  } catch (error) {
    logger.error("opportunity.persistence.failed", { userId, auditId, error });
    return { status: "error", message: "Unable to start opportunity analysis." };
  }
  logger.info("opportunity.analysis.started", {
    userId,
    auditId,
    analysisId: analysis.id,
    model,
    promptVersion: OPPORTUNITY_PROMPT_VERSION,
  });
  try {
    const input = buildOpportunityInput({
      prospectName: prospect.businessName,
      requestedUrl: audit.requestedUrl,
      audit,
      checks: audit.checks,
    });
    const generated = await generateOpportunity(input, { model });
    await database.$transaction([
      database.opportunityRecommendation.createMany({
        data: generated.output.recommendations.map((item, position) => ({
          analysisId: analysis.id,
          position,
          ...item,
        })),
      }),
      database.opportunityAnalysis.update({
        where: { id: analysis.id },
        data: {
          status: "COMPLETED",
          overallScore: generated.output.overallScore,
          categoryScores: generated.output.categoryScores,
          executiveSummary: generated.output.executiveSummary,
          overallRationale: generated.output.overallRationale,
          inputTokens: generated.inputTokens,
          outputTokens: generated.outputTokens,
          durationMs: generated.durationMs,
          completedAt: new Date(),
        },
      }),
    ]);
    logger.info("opportunity.analysis.succeeded", {
      userId,
      auditId,
      analysisId: analysis.id,
      model,
      promptVersion: OPPORTUNITY_PROMPT_VERSION,
      durationMs: generated.durationMs,
      inputTokens: generated.inputTokens,
      outputTokens: generated.outputTokens,
      recommendationCount: generated.output.recommendations.length,
    });
  } catch (error) {
    const rawCode =
      typeof error === "object" && error && "code" in error
        ? String(error.code)
        : "INTERNAL_ERROR";
    const failureCode = rawCode in failureMessages ? rawCode : "INTERNAL_ERROR";
    try {
      await database.opportunityAnalysis.update({
        where: { id: analysis.id },
        data: {
          status: "FAILED",
          overallScore: null,
          executiveSummary: null,
          overallRationale: null,
          failureCode,
          failureMessage: failureMessages[failureCode],
          completedAt: new Date(),
        },
      });
    } catch (persistenceError) {
      logger.error("opportunity.persistence.failed", {
        userId,
        auditId,
        analysisId: analysis.id,
        error: persistenceError,
      });
      return { status: "error", message: "Unable to save opportunity analysis." };
    }
    logger.error("opportunity.analysis.failed", {
      userId,
      auditId,
      analysisId: analysis.id,
      model,
      failureCode,
      error,
    });
  }
  revalidatePath("/opportunities");
  revalidatePath(`/audits/${auditId}`);
  redirect(`/opportunities/${analysis.id}`);
};

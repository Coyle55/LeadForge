"use server";

import { isAllowedUserId } from "@repo/auth";
import { auth } from "@repo/auth/server";
import { database, type Prisma } from "@repo/database";
import { logger } from "@repo/observability";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { env } from "../../env";
import { buildAllowedNumbers } from "../lib/opportunity/allowed-numbers";
import {
  generateInterpretation,
  InterpretationGenerationError,
} from "../lib/opportunity/generate";
import { INTERPRETATION_PROMPT_VERSION } from "../lib/opportunity/prompt";
import { selectRecommendations } from "../lib/opportunity/recommend";
import { computeOpportunityScore } from "../lib/opportunity/scoring";

// ScoringBreakdownEntry[]/TopReason[] are plain, JSON-serializable arrays
// (numbers/strings plus AuditCheck.evidence, which is already a Prisma
// Json value) — this narrows them to Prisma's Json input type without
// changing their runtime shape.
const asJson = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue;

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
    select: { businessName: true, businessCategory: true },
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
        promptVersion: INTERPRETATION_PROMPT_VERSION,
      },
      select: { id: true },
    });
  } catch (error) {
    logger.error("opportunity.persistence.failed", { userId, auditId, error });
    return {
      status: "error",
      message: "Unable to start opportunity analysis.",
    };
  }
  logger.info("opportunity.analysis.started", {
    userId,
    auditId,
    analysisId: analysis.id,
    model,
    promptVersion: INTERPRETATION_PROMPT_VERSION,
  });

  // Pure, cannot throw for valid input — deliberately not wrapped in their
  // own try/catch (see task brief). Any genuinely unexpected failure here
  // still falls into the outer try/catch below and is marked FAILED.
  const scoringResult = computeOpportunityScore({
    businessCategory: prospect.businessCategory ?? null,
    checks: audit.checks,
    pagesAudited: audit.pagesAudited,
  });
  const recommendations = selectRecommendations(
    audit.checks,
    prospect.businessCategory ?? null
  );

  try {
    if (scoringResult.disqualifiers.length > 0) {
      await database.opportunityAnalysis.update({
        where: { id: analysis.id },
        data: {
          status: "COMPLETED",
          scoringMethod: "DETERMINISTIC",
          tier: scoringResult.tier,
          overallScore: 0,
          categoryScores: scoringResult.categoryScores,
          scoringBreakdown: asJson(scoringResult.scoringBreakdown),
          topReasons: asJson(scoringResult.topReasons),
          disqualifiers: scoringResult.disqualifiers,
          completedAt: new Date(),
        },
      });
      logger.info("opportunity.analysis.disqualified", {
        userId,
        auditId,
        analysisId: analysis.id,
        disqualifiers: scoringResult.disqualifiers,
      });
    } else {
      const allowedNumbers = buildAllowedNumbers(scoringResult, recommendations);
      const expectedServiceCategories = recommendations.map(
        (candidate) => candidate.serviceCategory
      );
      const interpretationInput = {
        tier: scoringResult.tier,
        overallScore: scoringResult.overallScore,
        categoryScores: scoringResult.categoryScores,
        scoringBreakdown: scoringResult.scoringBreakdown,
        topReasons: scoringResult.topReasons,
        disqualifiers: scoringResult.disqualifiers,
        recommendations: recommendations.map((candidate) => ({
          serviceCategory: candidate.serviceCategory,
          weight: candidate.weight,
          effort: candidate.effort,
          impact: candidate.impact,
          confidence: candidate.confidence,
          supportingCheckKeys: candidate.supportingCheckKeys,
        })),
        allowedNumbers,
        expectedServiceCategories,
      };

      let generated: Awaited<ReturnType<typeof generateInterpretation>> | undefined;
      try {
        generated = await generateInterpretation(interpretationInput, { model });
      } catch (error) {
        if (!(error instanceof InterpretationGenerationError)) {
          throw error;
        }
        // The score itself is real and complete regardless of whether the
        // AI prose call succeeded — persist it as COMPLETED. There is no
        // deterministic fallback for recommendation title/rationale/action
        // text, so zero recommendation rows are created (never fabricated).
        await database.opportunityAnalysis.update({
          where: { id: analysis.id },
          data: {
            status: "COMPLETED",
            scoringMethod: "DETERMINISTIC",
            tier: scoringResult.tier,
            overallScore: scoringResult.overallScore,
            categoryScores: scoringResult.categoryScores,
            scoringBreakdown: asJson(scoringResult.scoringBreakdown),
            topReasons: asJson(scoringResult.topReasons),
            disqualifiers: scoringResult.disqualifiers,
            completedAt: new Date(),
          },
        });
        logger.error("opportunity.interpretation.failed", {
          userId,
          auditId,
          analysisId: analysis.id,
          model,
          failureCode: error.code,
        });
      }

      if (generated) {
        const copyByCategory = new Map(
          generated.output.recommendations.map((copy) => [
            copy.serviceCategory,
            copy,
          ])
        );
        await database.$transaction([
          database.opportunityRecommendation.createMany({
            data: recommendations.map((candidate, position) => {
              const copy = copyByCategory.get(candidate.serviceCategory);
              if (!copy) {
                // validateInterpretationOutput's set-equality check already
                // guarantees this can't happen; this is a defensive guard.
                throw new Error(
                  "Missing interpretation copy for a selected service category"
                );
              }
              return {
                analysisId: analysis.id,
                position,
                title: copy.title,
                rationale: copy.rationale,
                action: copy.action,
                impact: candidate.impact,
                effort: candidate.effort,
                serviceCategory: candidate.serviceCategory,
                confidence: candidate.confidence,
                auditCheckKeys: candidate.supportingCheckKeys,
              };
            }),
          }),
          database.opportunityAnalysis.update({
            where: { id: analysis.id },
            data: {
              status: "COMPLETED",
              scoringMethod: "DETERMINISTIC",
              tier: scoringResult.tier,
              overallScore: scoringResult.overallScore,
              categoryScores: scoringResult.categoryScores,
              scoringBreakdown: asJson(scoringResult.scoringBreakdown),
              topReasons: asJson(scoringResult.topReasons),
              disqualifiers: scoringResult.disqualifiers,
              strongestIssue: generated.output.strongestIssue,
              suggestedOffer: generated.output.suggestedOffer,
              confidence: generated.output.confidence,
              warnings: generated.output.warnings,
              executiveSummary: generated.output.summary,
              overallRationale: generated.output.practicalImpact,
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
          promptVersion: INTERPRETATION_PROMPT_VERSION,
          durationMs: generated.durationMs,
          inputTokens: generated.inputTokens,
          outputTokens: generated.outputTokens,
          recommendationCount: recommendations.length,
        });
      }
    }
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
      return {
        status: "error",
        message: "Unable to save opportunity analysis.",
      };
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

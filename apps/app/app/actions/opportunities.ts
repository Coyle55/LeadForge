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
import {
  type RecommendationCandidate,
  selectRecommendations,
} from "../lib/opportunity/recommend";
import {
  computeOpportunityScore,
  type ScoringResult,
} from "../lib/opportunity/scoring";

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

// Persists a disqualified analysis (e.g. incomplete audit, unreachable
// site) as COMPLETED with a zero score and no recommendations, and logs
// the outcome. Extracted from analyzeAuditOpportunity to keep the
// disqualified branch's persistence + logging together as one step.
const persistDisqualifiedAnalysis = async (
  scoringResult: ScoringResult,
  context: { userId: string; auditId: string; analysisId: string }
): Promise<void> => {
  await database.opportunityAnalysis.update({
    where: { id: context.analysisId },
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
    userId: context.userId,
    auditId: context.auditId,
    analysisId: context.analysisId,
    disqualifiers: scoringResult.disqualifiers,
  });
};

// Builds the opportunityRecommendation row data for the success path,
// matching each selected candidate to the AI-generated copy for its
// service category. Pure and side-effect free; the caller performs the
// actual createMany within a transaction.
const buildRecommendationRows = (
  analysisId: string,
  recommendations: RecommendationCandidate[],
  generated: Awaited<ReturnType<typeof generateInterpretation>>
) => {
  const copyByCategory = new Map(
    generated.output.recommendations.map((copy) => [copy.serviceCategory, copy])
  );
  return recommendations.map((candidate, position) => {
    const copy = copyByCategory.get(candidate.serviceCategory);
    if (!copy) {
      // validateInterpretationOutput's set-equality check already
      // guarantees this can't happen; this is a defensive guard.
      throw new Error(
        "Missing interpretation copy for a selected service category"
      );
    }
    return {
      analysisId,
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
  });
};

const resolveFailureCode = (error: unknown): string => {
  const rawCode =
    typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "INTERNAL_ERROR";
  return rawCode in failureMessages ? rawCode : "INTERNAL_ERROR";
};

// Persists a FAILED analysis row after an unexpected error and logs the
// outcome. Returns an error result only when persisting the failure
// itself also fails (the caller returns early in that case); otherwise
// returns undefined so the caller continues to its normal redirect.
const persistAnalysisFailure = async (
  error: unknown,
  context: {
    userId: string;
    auditId: string;
    analysisId: string;
    model: string;
  }
): Promise<{ status: "error"; message: string } | undefined> => {
  const failureCode = resolveFailureCode(error);
  try {
    await database.opportunityAnalysis.update({
      where: { id: context.analysisId },
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
      userId: context.userId,
      auditId: context.auditId,
      analysisId: context.analysisId,
      error: persistenceError,
    });
    return {
      status: "error",
      message: "Unable to save opportunity analysis.",
    };
  }
  logger.error("opportunity.analysis.failed", {
    userId: context.userId,
    auditId: context.auditId,
    analysisId: context.analysisId,
    model: context.model,
    failureCode,
    error,
  });
  return undefined;
};

// Resolves and validates everything analyzeAuditOpportunity needs before it
// can start an analysis: auth/authorization, the completed audit, the
// configured model, and the associated prospect. Also redirects (via a
// thrown NEXT_REDIRECT, same as the original inline check) to an existing
// in-flight analysis instead of starting a duplicate. Returns an error
// result on any failed check so the caller can return it unchanged.
const resolveAnalysisContext = async (auditId: string) => {
  const { userId } = await auth();
  if (!(userId && isAllowedUserId(userId))) {
    return { error: { status: "error" as const, message: "Not authorized." } };
  }
  const audit = await database.websiteAudit.findFirst({
    where: { id: auditId, userId, status: "COMPLETED" },
    include: { checks: true },
  });
  if (!audit) {
    return {
      error: {
        status: "error" as const,
        message: "Completed audit not found.",
      },
    };
  }
  const model = env.AI_GATEWAY_MODEL;
  if (!model) {
    return {
      error: {
        status: "error" as const,
        message: failureMessages.MODEL_NOT_CONFIGURED,
      },
    };
  }
  const prospect = await database.prospect.findFirst({
    where: { id: audit.prospectId, userId },
    select: { businessName: true, businessCategory: true },
  });
  if (!prospect) {
    return {
      error: {
        status: "error" as const,
        message: "Completed audit not found.",
      },
    };
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
  }
  return { context: { userId, audit, model, prospect } };
};

export const analyzeAuditOpportunity = async (
  auditId: string
): Promise<{ status: "error"; message: string } | undefined> => {
  const resolved = await resolveAnalysisContext(auditId);
  if ("error" in resolved) {
    return resolved.error;
  }
  const { userId, audit, model, prospect } = resolved.context;
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
      await persistDisqualifiedAnalysis(scoringResult, {
        userId,
        auditId,
        analysisId: analysis.id,
      });
    } else {
      const allowedNumbers = buildAllowedNumbers(
        scoringResult,
        recommendations
      );
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

      let generated:
        | Awaited<ReturnType<typeof generateInterpretation>>
        | undefined;
      try {
        generated = await generateInterpretation(interpretationInput, {
          model,
        });
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
        const recommendationRows = buildRecommendationRows(
          analysis.id,
          recommendations,
          generated
        );
        await database.$transaction([
          database.opportunityRecommendation.createMany({
            data: recommendationRows,
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
    const failureResult = await persistAnalysisFailure(error, {
      userId,
      auditId,
      analysisId: analysis.id,
      model,
    });
    if (failureResult) {
      return failureResult;
    }
  }
  revalidatePath("/opportunities");
  revalidatePath(`/audits/${auditId}`);
  redirect(`/opportunities/${analysis.id}`);
};

"use server";

import { isAllowedUserId } from "@repo/auth";
import { auth } from "@repo/auth/server";
import { database } from "@repo/database";
import { logger } from "@repo/observability";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { env } from "../../env";
import {
  generateOutreach,
  OutreachGenerationError,
} from "../lib/outreach/generate";
import { buildOutreachInput } from "../lib/outreach/input";
import { OUTREACH_PROMPT_VERSION } from "../lib/outreach/prompt";

export interface OutreachActionError {
  href?: string;
  message: string;
  status: "error";
}

const failureMessages: Record<string, string> = {
  RATE_LIMITED: "The AI outreach service is temporarily rate limited.",
  TIMEOUT: "The AI outreach request timed out.",
  GATEWAY_ERROR: "The AI outreach service could not complete this request.",
  INVALID_OUTPUT: "The AI response did not meet the required outreach format.",
  INTERNAL_ERROR: "The outreach draft could not be completed.",
};

const revalidateDraftPaths = (analysisId: string, draftId: string) => {
  revalidatePath("/outreach");
  revalidatePath(`/opportunities/${analysisId}`);
  revalidatePath(`/outreach/${draftId}`);
};

interface DraftLogContext {
  analysisId: string;
  draftId: string;
  model: string;
  promptVersion: string;
  prospectId: string;
  recommendationId: string;
  userId: string;
}

const classifyFailure = (error: unknown) => {
  let rawCode = "INTERNAL_ERROR";
  if (error instanceof OutreachGenerationError) {
    rawCode = error.code;
  } else if (typeof error === "object" && error && "code" in error) {
    rawCode = String(error.code);
  }

  return rawCode in failureMessages ? rawCode : "INTERNAL_ERROR";
};

const persistFailedDraft = async ({
  context,
  failureCode,
}: {
  context: DraftLogContext;
  failureCode: string;
}) => {
  try {
    await database.outreachDraft.update({
      where: { id: context.draftId },
      data: {
        status: "FAILED",
        generatedSubject: null,
        generatedBody: null,
        subject: null,
        body: null,
        failureCode,
        failureMessage: failureMessages[failureCode],
        completedAt: new Date(),
      },
    });
  } catch {
    logger.error("outreach.persistence.failed", { ...context, failureCode });
    return false;
  }

  logger.error("outreach.generation.failed", { ...context, failureCode });
  return true;
};

const persistCompletedDraft = async ({
  context,
  generated,
}: {
  context: DraftLogContext;
  generated: Awaited<ReturnType<typeof generateOutreach>>;
}) => {
  try {
    await database.outreachDraft.update({
      where: { id: context.draftId },
      data: {
        status: "COMPLETED",
        generatedSubject: generated.output.subject,
        generatedBody: generated.output.body,
        subject: generated.output.subject,
        body: generated.output.body,
        inputTokens: generated.inputTokens,
        outputTokens: generated.outputTokens,
        durationMs: generated.durationMs,
        failureCode: null,
        failureMessage: null,
        completedAt: new Date(),
      },
    });
  } catch {
    logger.error("outreach.persistence.failed", { ...context });
    return false;
  }

  logger.info("outreach.generation.succeeded", {
    ...context,
    durationMs: generated.durationMs,
    inputTokens: generated.inputTokens,
    outputTokens: generated.outputTokens,
  });
  return true;
};

export const generateOutreachDraft = async (
  recommendationId: string
): Promise<OutreachActionError | undefined> => {
  const { userId } = await auth();
  if (!(userId && isAllowedUserId(userId))) {
    return { status: "error", message: "Not authorized." };
  }

  const recommendation = await database.opportunityRecommendation.findFirst({
    where: {
      id: recommendationId,
      analysis: { userId, status: "COMPLETED" },
    },
    include: { analysis: true },
  });
  if (!recommendation || recommendation.analysis.userId !== userId) {
    return { status: "error", message: "Completed recommendation not found." };
  }

  const prospect = await database.prospect.findFirst({
    where: { id: recommendation.analysis.prospectId, userId },
  });
  if (!prospect) {
    return { status: "error", message: "Completed recommendation not found." };
  }

  if (!prospect.contactName?.trim()) {
    return {
      status: "error",
      message: "Add a contact name before drafting outreach.",
      href: `/prospects/${prospect.id}`,
    };
  }
  if (!prospect.contactEmail?.trim()) {
    return {
      status: "error",
      message: "Add a contact email before drafting outreach.",
      href: `/prospects/${prospect.id}`,
    };
  }

  const audit = await database.websiteAudit.findFirst({
    where: {
      id: recommendation.analysis.auditId,
      userId,
      prospectId: prospect.id,
      status: "COMPLETED",
    },
    include: { checks: true },
  });
  if (!audit) {
    return { status: "error", message: "Completed recommendation not found." };
  }

  const profile = await database.outreachProfile.findUnique({
    where: { userId },
  });
  if (!profile) {
    return {
      status: "error",
      message: "Complete your outreach profile before drafting outreach.",
      href: "/settings",
    };
  }

  const model = env.AI_GATEWAY_MODEL;
  if (!model) {
    return {
      status: "error",
      message: "AI Gateway model configuration is required.",
    };
  }

  const recent = await database.outreachDraft.findFirst({
    where: {
      userId,
      recommendationId,
      status: "RUNNING",
      createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
    },
    select: { id: true },
  });
  if (recent) {
    redirect(`/outreach/${recent.id}`);
    return;
  }

  const contactName = prospect.contactName.trim();
  const contactEmail = prospect.contactEmail.trim();
  const websiteHostname = new URL(audit.requestedUrl).hostname;
  let draft: { id: string };
  try {
    draft = await database.outreachDraft.create({
      data: {
        userId,
        prospectId: prospect.id,
        analysisId: recommendation.analysis.id,
        recommendationId: recommendation.id,
        status: "RUNNING",
        recipientName: contactName,
        recipientEmail: contactEmail,
        businessName: prospect.businessName,
        websiteHostname,
        recommendationTitle: recommendation.title,
        model,
        promptVersion: OUTREACH_PROMPT_VERSION,
      },
      select: { id: true },
    });
  } catch {
    logger.error("outreach.persistence.failed", {
      userId,
      prospectId: prospect.id,
      analysisId: recommendation.analysis.id,
      recommendationId: recommendation.id,
      model,
      promptVersion: OUTREACH_PROMPT_VERSION,
    });
    return { status: "error", message: "Unable to start outreach draft." };
  }

  logger.info("outreach.generation.started", {
    userId,
    prospectId: prospect.id,
    analysisId: recommendation.analysis.id,
    recommendationId: recommendation.id,
    draftId: draft.id,
    model,
    promptVersion: OUTREACH_PROMPT_VERSION,
  });

  const draftContext: DraftLogContext = {
    userId,
    prospectId: prospect.id,
    analysisId: recommendation.analysis.id,
    recommendationId: recommendation.id,
    draftId: draft.id,
    model,
    promptVersion: OUTREACH_PROMPT_VERSION,
  };

  let generated: Awaited<ReturnType<typeof generateOutreach>>;
  try {
    const input = buildOutreachInput({
      prospect: {
        contactName,
        name: prospect.businessName,
        requestedUrl: audit.requestedUrl,
      },
      recommendation: {
        title: recommendation.title,
        rationale: recommendation.rationale,
        action: recommendation.action,
        auditCheckKeys: recommendation.auditCheckKeys as string[],
      },
      checks: audit.checks,
      sender: {
        senderName: profile.senderName,
        companyName: profile.companyName,
        serviceOffered: profile.serviceOffered,
        valueProposition: profile.valueProposition,
        defaultCta: profile.defaultCta,
      },
    });
    generated = await generateOutreach(input, { model });
  } catch (error) {
    const failureCode = classifyFailure(error);
    const saved = await persistFailedDraft({
      context: draftContext,
      failureCode,
    });
    if (!saved) {
      return { status: "error", message: "Unable to save outreach draft." };
    }

    revalidateDraftPaths(recommendation.analysis.id, draft.id);
    redirect(`/outreach/${draft.id}`);
    return;
  }

  const saved = await persistCompletedDraft({
    context: draftContext,
    generated,
  });
  if (!saved) {
    return { status: "error", message: "Unable to save outreach draft." };
  }

  revalidateDraftPaths(recommendation.analysis.id, draft.id);
  redirect(`/outreach/${draft.id}`);
};

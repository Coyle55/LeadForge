"use server";

import { isAllowedUserId } from "@repo/auth";
import { auth } from "@repo/auth/server";
import { database, type PipelineStage } from "@repo/database";
import { logger } from "@repo/observability";
import { dealEditSchema, pipelineTransitionSchema } from "@repo/validation";
import { revalidatePath } from "next/cache";

export interface PipelineFormState {
  fieldErrors?: Record<string, string[]>;
  message?: string;
  status?: "success" | "error";
}

type PipelineMutationAction = "move" | "save_deal";
type SafeFailureCode =
  | "CACHE_REVALIDATION_ERROR"
  | "DATABASE_ERROR"
  | "LOGGING_ERROR";

type PipelineMutationMetadata = Record<string, unknown> & {
  action: PipelineMutationAction;
  destination?: PipelineStage;
  prospectId: string;
  userId: string;
};

class MutationRaceError extends Error {}

const DEAL_EDIT_STAGES = new Set<PipelineStage>([
  "INTERESTED",
  "PROPOSAL",
  "WON",
  "LOST",
]);

const authorize = async () => {
  const { userId } = await auth();
  return userId && isAllowedUserId(userId) ? userId : null;
};

const formString = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : null;
};

const getProspectId = (formData: FormData) =>
  formString(formData, "prospectId")?.trim() ?? "";

const parseTransitionForm = (formData: FormData) => {
  const destination = formString(formData, "destination");

  return pipelineTransitionSchema.safeParse({
    actualCloseDate:
      destination === "WON" ? formString(formData, "actualCloseDate") : null,
    destination,
    lossReason:
      destination === "LOST" ? formString(formData, "lossReason") : null,
    value: destination === "WON" ? formString(formData, "value") : null,
  });
};

const parseDealForm = (formData: FormData) =>
  dealEditSchema.safeParse({
    expectedCloseDate: formString(formData, "expectedCloseDate"),
    value: formString(formData, "value"),
  });

const safeErrorLog = (
  event: string,
  metadata: PipelineMutationMetadata & { code: SafeFailureCode }
) => {
  try {
    logger.error(event, metadata);
  } catch {
    // Observability must not change an action result.
  }
};

const logMutationSuccess = (metadata: PipelineMutationMetadata) => {
  try {
    logger.info("pipeline.mutation.succeeded", metadata);
  } catch {
    safeErrorLog("pipeline.observability.failed", {
      ...metadata,
      code: "LOGGING_ERROR",
    });
  }
};

const revalidatePipelinePaths = (metadata: PipelineMutationMetadata) => {
  let failed = false;
  const paths = [
    "/pipeline",
    `/prospects/${metadata.prospectId}`,
    "/prospects",
    "/",
  ];

  for (const path of paths) {
    try {
      revalidatePath(path);
    } catch {
      failed = true;
    }
  }

  if (failed) {
    safeErrorLog("pipeline.revalidation.failed", {
      ...metadata,
      code: "CACHE_REVALIDATION_ERROR",
    });
  }
};

const finishCommittedMutation = (metadata: PipelineMutationMetadata) => {
  logMutationSuccess(metadata);
  revalidatePipelinePaths(metadata);
};

const invalidFormResult = (
  fieldErrors: Record<string, string[]> = {}
): PipelineFormState => ({
  fieldErrors,
  message: "Check the highlighted fields.",
  status: "error",
});

const humanizeStage = (stage: PipelineStage) =>
  stage.charAt(0) + stage.slice(1).toLowerCase();

export const moveProspectStage = async (
  _previousState: PipelineFormState,
  formData: FormData
): Promise<PipelineFormState> => {
  const userId = await authorize();
  if (!userId) {
    return { message: "Not authorized.", status: "error" };
  }

  const prospectId = getProspectId(formData);
  const parsed = parseTransitionForm(formData);
  if (!(prospectId && parsed.success)) {
    return invalidFormResult({
      ...(parsed.success ? {} : parsed.error.flatten().fieldErrors),
      ...(prospectId ? {} : { prospectId: ["Prospect is required."] }),
    });
  }

  const { actualCloseDate, destination, lossReason, valueCents } = parsed.data;
  const metadata: PipelineMutationMetadata = {
    action: "move",
    destination,
    prospectId,
    userId,
  };

  try {
    const outcome = await database.$transaction(
      async (transaction) => {
        const prospect = await transaction.prospect.findFirst({
          where: { id: prospectId, userId, archivedAt: null },
          select: { id: true, pipelineStage: true },
        });
        if (!prospect) {
          return "not_found" as const;
        }

        const deal = await transaction.deal.findFirst({
          where: { prospectId: prospect.id, userId },
          select: { id: true },
        });

        let terminalData: {
          actualCloseDate: Date | null;
          lossReason: string | null;
          valueCents?: number | null;
        } = { actualCloseDate: null, lossReason: null };
        if (destination === "WON") {
          terminalData = { valueCents, actualCloseDate, lossReason: null };
        } else if (destination === "LOST") {
          terminalData = { actualCloseDate: null, lossReason };
        }

        if (deal) {
          const dealResult = await transaction.deal.updateMany({
            where: { id: deal.id, prospectId: prospect.id, userId },
            data: terminalData,
          });
          if (dealResult.count !== 1) {
            throw new MutationRaceError();
          }
        } else if (destination === "WON" || destination === "LOST") {
          await transaction.deal.create({
            data: {
              userId,
              prospectId: prospect.id,
              ...terminalData,
            },
            select: { id: true },
          });
        }

        const prospectResult = await transaction.prospect.updateMany({
          where: {
            id: prospect.id,
            userId,
            archivedAt: null,
            pipelineStage: prospect.pipelineStage,
          },
          data: { pipelineStage: destination },
        });
        if (prospectResult.count !== 1) {
          throw new MutationRaceError();
        }

        return "success" as const;
      },
      { isolationLevel: "Serializable" }
    );

    if (outcome === "not_found") {
      return { message: "Prospect not found.", status: "error" };
    }
  } catch (error) {
    if (error instanceof MutationRaceError) {
      return { message: "Prospect not found.", status: "error" };
    }
    safeErrorLog("pipeline.mutation.failed", {
      ...metadata,
      code: "DATABASE_ERROR",
    });
    return { message: "Unable to move prospect.", status: "error" };
  }

  finishCommittedMutation(metadata);
  return {
    message: `Prospect moved to ${humanizeStage(destination)}.`,
    status: "success",
  };
};

export const saveDeal = async (
  _previousState: PipelineFormState,
  formData: FormData
): Promise<PipelineFormState> => {
  const userId = await authorize();
  if (!userId) {
    return { message: "Not authorized.", status: "error" };
  }

  const prospectId = getProspectId(formData);
  const parsed = parseDealForm(formData);
  if (!(prospectId && parsed.success)) {
    return invalidFormResult({
      ...(parsed.success ? {} : parsed.error.flatten().fieldErrors),
      ...(prospectId ? {} : { prospectId: ["Prospect is required."] }),
    });
  }

  const metadata: PipelineMutationMetadata = {
    action: "save_deal",
    prospectId,
    userId,
  };

  try {
    const outcome = await database.$transaction(
      async (transaction) => {
        const prospect = await transaction.prospect.findFirst({
          where: { id: prospectId, userId, archivedAt: null },
          select: { id: true, pipelineStage: true },
        });
        if (!prospect) {
          return "not_found" as const;
        }
        if (!DEAL_EDIT_STAGES.has(prospect.pipelineStage)) {
          return "invalid_stage" as const;
        }

        const deal = await transaction.deal.findFirst({
          where: { prospectId: prospect.id, userId },
          select: { id: true },
        });
        if (deal) {
          const result = await transaction.deal.updateMany({
            where: { id: deal.id, prospectId: prospect.id, userId },
            data: parsed.data,
          });
          if (result.count !== 1) {
            throw new MutationRaceError();
          }
        } else {
          await transaction.deal.create({
            data: { userId, prospectId: prospect.id, ...parsed.data },
            select: { id: true },
          });
        }

        return "success" as const;
      },
      { isolationLevel: "Serializable" }
    );

    if (outcome === "not_found") {
      return { message: "Prospect not found.", status: "error" };
    }
    if (outcome === "invalid_stage") {
      return {
        message: "Deal editing is not available at this stage.",
        status: "error",
      };
    }
  } catch (error) {
    if (error instanceof MutationRaceError) {
      return { message: "Prospect not found.", status: "error" };
    }
    safeErrorLog("pipeline.mutation.failed", {
      ...metadata,
      code: "DATABASE_ERROR",
    });
    return { message: "Unable to save deal.", status: "error" };
  }

  finishCommittedMutation(metadata);
  return { message: "Deal saved.", status: "success" };
};

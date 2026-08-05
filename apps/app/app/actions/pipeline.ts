"use server";

import { isAllowedUserId } from "@repo/auth";
import { auth } from "@repo/auth/server";
import { database, type PipelineStage, type Prisma } from "@repo/database";
import { logger } from "@repo/observability";
import {
  type DealEditInput,
  dealEditSchema,
  type PipelineTransitionInput,
  pipelineTransitionSchema,
} from "@repo/validation";
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

const MAX_TRANSACTION_ATTEMPTS = 3;

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

const getPrismaErrorCode = (error: unknown) => {
  if (!(typeof error === "object" && error !== null && "code" in error)) {
    return null;
  }

  const { code } = error as { code?: unknown };
  return typeof code === "string" ? code : null;
};

const runRetriableTransaction = async <Result>(
  operation: () => Promise<Result>
): Promise<Result> => {
  let lastError: unknown;
  let retriedUniqueConflict = false;

  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const code = getPrismaErrorCode(error);
      const retrySerializationConflict = code === "P2034";
      const retryFirstCreateConflict =
        code === "P2002" && !retriedUniqueConflict;

      if (
        attempt === MAX_TRANSACTION_ATTEMPTS ||
        !(retrySerializationConflict || retryFirstCreateConflict)
      ) {
        throw error;
      }
      if (retryFirstCreateConflict) {
        retriedUniqueConflict = true;
      }
    }
  }

  throw lastError;
};

interface OwnedDealId {
  id: string;
}

interface TerminalDealSnapshot extends OwnedDealId {
  actualCloseDate: Date | null;
  lossReason: string | null;
  valueCents: number | null;
}

const getTerminalData = (transition: PipelineTransitionInput) => {
  if (transition.destination === "WON") {
    return {
      valueCents: transition.valueCents,
      actualCloseDate: transition.actualCloseDate,
      lossReason: null,
    };
  }
  if (transition.destination === "LOST") {
    return {
      actualCloseDate: null,
      lossReason: transition.lossReason,
    };
  }
  return { actualCloseDate: null, lossReason: null };
};

const persistTransitionDeal = async ({
  transaction,
  deal,
  prospectId,
  userId,
  transition,
}: {
  deal: OwnedDealId | null;
  prospectId: string;
  transaction: Prisma.TransactionClient;
  transition: PipelineTransitionInput;
  userId: string;
}) => {
  const data = getTerminalData(transition);
  if (deal) {
    const result = await transaction.deal.updateMany({
      where: { id: deal.id, prospectId, userId },
      data,
    });
    if (result.count !== 1) {
      throw new MutationRaceError();
    }
    return;
  }

  if (transition.destination === "WON" || transition.destination === "LOST") {
    await transaction.deal.create({
      data: { userId, prospectId, ...data },
      select: { id: true },
    });
  }
};

const executeMoveTransaction = async ({
  prospectId,
  transition,
  userId,
}: {
  prospectId: string;
  transition: PipelineTransitionInput;
  userId: string;
}) =>
  await database.$transaction(
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
      await persistTransitionDeal({
        transaction,
        deal,
        prospectId: prospect.id,
        userId,
        transition,
      });

      const result = await transaction.prospect.updateMany({
        where: {
          id: prospect.id,
          userId,
          archivedAt: null,
          pipelineStage: prospect.pipelineStage,
        },
        data: { pipelineStage: transition.destination },
      });
      if (result.count !== 1) {
        throw new MutationRaceError();
      }

      await transaction.pipelineStageChange.create({
        data: {
          userId,
          prospectId: prospect.id,
          fromStage: prospect.pipelineStage,
          toStage: transition.destination,
        },
      });

      return "success" as const;
    },
    { isolationLevel: "Serializable" }
  );

const hasValidTerminalState = (
  stage: PipelineStage,
  deal: TerminalDealSnapshot | null,
  input: DealEditInput
) => {
  if (stage === "WON") {
    return (
      Number.isInteger(input.valueCents) &&
      (input.valueCents ?? 0) > 0 &&
      deal?.actualCloseDate !== null &&
      deal?.actualCloseDate !== undefined
    );
  }
  if (stage === "LOST") {
    return Boolean(deal?.lossReason?.trim());
  }
  return true;
};

const executeSaveDealTransaction = async ({
  input,
  prospectId,
  userId,
}: {
  input: DealEditInput;
  prospectId: string;
  userId: string;
}) =>
  await database.$transaction(
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
        select: {
          id: true,
          valueCents: true,
          actualCloseDate: true,
          lossReason: true,
        },
      });
      if (!hasValidTerminalState(prospect.pipelineStage, deal, input)) {
        return "invalid_terminal_state" as const;
      }

      if (deal) {
        const result = await transaction.deal.updateMany({
          where: { id: deal.id, prospectId: prospect.id, userId },
          data: input,
        });
        if (result.count !== 1) {
          throw new MutationRaceError();
        }
      } else {
        await transaction.deal.create({
          data: { userId, prospectId: prospect.id, ...input },
          select: { id: true },
        });
      }

      return "success" as const;
    },
    { isolationLevel: "Serializable" }
  );

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

  const { destination } = parsed.data;
  const metadata: PipelineMutationMetadata = {
    action: "move",
    destination,
    prospectId,
    userId,
  };

  try {
    const outcome = await runRetriableTransaction(async () =>
      executeMoveTransaction({ prospectId, transition: parsed.data, userId })
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
    const outcome = await runRetriableTransaction(async () =>
      executeSaveDealTransaction({ input: parsed.data, prospectId, userId })
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
    if (outcome === "invalid_terminal_state") {
      return {
        message: "Deal closing details are incomplete.",
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

"use server";

import { isAllowedUserId } from "@repo/auth";
import { auth } from "@repo/auth/server";
import { database, type Prisma } from "@repo/database";
import { logger } from "@repo/observability";
import { prospectSchema } from "@repo/validation";
import { z } from "zod";
import { env } from "../../env";
import { buildDiscoveryCacheKey } from "../lib/discovery/cache-key";
import {
  buildExistingIdentityIndex,
  findDuplicateProspectId,
} from "../lib/discovery/duplicates";
import { DiscoveryGenerationError } from "../lib/discovery/generate";
import { PerplexityGatewayDiscoveryProvider } from "../lib/discovery/perplexity-provider";
import type {
  DiscoveredProspect,
  ProspectDiscoveryResult,
} from "../lib/discovery/types";

// Search results are never model-generated business data by the time they
// reach this cast -- they were already validated candidate-by-candidate in
// PerplexityGatewayDiscoveryProvider (Task 3) before being written here, so
// this only narrows the plain, JSON-serializable result shape to Prisma's
// Json input type (matching opportunities.ts's `asJson` precedent).
const asJson = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue;

const DISCOVERY_PROVIDER = "PERPLEXITY_GATEWAY_SEARCH";

const searchInputSchema = z.object({
  businessType: z.string().trim().min(1, "Business type is required."),
  location: z.string().trim().min(1, "Location is required."),
  resultLimit: z
    .number()
    .int("Result count must be a whole number.")
    .min(1, "Result count must be at least 1.")
    .max(25, "Result count cannot exceed 25."),
});

const failureMessages: Record<string, string> = {
  MODEL_NOT_CONFIGURED: "AI Gateway model configuration is required.",
  RATE_LIMITED: "The AI discovery service is temporarily rate limited.",
  TIMEOUT: "The AI discovery request timed out.",
  GATEWAY_ERROR: "The AI discovery service could not complete this request.",
  INVALID_OUTPUT: "The AI response did not meet the required discovery format.",
  INTERNAL_ERROR: "The prospect search could not be completed.",
};

export type SearchProspectsResult =
  | {
      status: "success";
      result: ProspectDiscoveryResult & {
        duplicateProspectIds: Record<string, string | null>;
      };
    }
  | {
      status: "error";
      message: string;
      fieldErrors?: Record<string, string[]>;
    };

const authorize = async (): Promise<string | null> => {
  const { userId } = await auth();
  return userId && isAllowedUserId(userId) ? userId : null;
};

const resolveFailureCode = (error: unknown): string => {
  const rawCode =
    error instanceof DiscoveryGenerationError ? error.code : "INTERNAL_ERROR";
  return rawCode in failureMessages ? rawCode : "INTERNAL_ERROR";
};

// Fetches the owner's *current* prospects and builds a fresh identity
// index from them. Shared by both preview-time duplicate annotation and
// import-time re-checking so both always dedup against live data rather
// than any snapshot taken earlier (e.g. from a cached search result).
const fetchCurrentIdentityIndex = async (userId: string) => {
  const existingProspects = await database.prospect.findMany({
    where: { userId, archivedAt: null },
    select: {
      id: true,
      businessName: true,
      websiteUrl: true,
      phone: true,
      location: true,
      sourceExternalId: true,
    },
  });
  return buildExistingIdentityIndex(existingProspects);
};

const findDuplicateForCandidate = (
  candidate: DiscoveredProspect,
  identityIndex: Awaited<ReturnType<typeof fetchCurrentIdentityIndex>>
) =>
  findDuplicateProspectId(
    {
      businessName: candidate.businessName,
      formattedAddress: candidate.formattedAddress ?? null,
      phone: candidate.phone ?? null,
      providerCandidateId: candidate.providerCandidateId ?? null,
      websiteUrl: candidate.websiteUrl ?? null,
    },
    identityIndex
  );

// Recomputes duplicate-status annotations against the owner's *current*
// prospects. Deliberately never reads dedup state from the cache row --
// dedup must reflect what exists right now even when the search results
// themselves come from a cache hit made minutes/hours earlier.
const annotateDuplicates = async (
  userId: string,
  results: DiscoveredProspect[]
): Promise<Record<string, string | null>> => {
  const identityIndex = await fetchCurrentIdentityIndex(userId);
  const duplicateProspectIds: Record<string, string | null> = {};
  for (const candidate of results) {
    duplicateProspectIds[candidate.discoveryId] = findDuplicateForCandidate(
      candidate,
      identityIndex
    );
  }
  return duplicateProspectIds;
};

export const searchProspects = async (input: {
  businessType: string;
  location: string;
  resultLimit: number;
}): Promise<SearchProspectsResult> => {
  const userId = await authorize();
  if (!userId) {
    return { status: "error", message: "Not authorized." };
  }

  const parsed = searchInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const { businessType, location, resultLimit } = parsed.data;

  const model = env.AI_GATEWAY_MODEL;
  if (!model) {
    return { status: "error", message: failureMessages.MODEL_NOT_CONFIGURED };
  }

  const cacheKey = buildDiscoveryCacheKey({
    businessType,
    location,
    model,
    provider: DISCOVERY_PROVIDER,
    resultLimit,
  });

  const started = Date.now();
  const cached = await database.prospectDiscoveryCache.findUnique({
    where: { userId_cacheKey: { userId, cacheKey } },
  });
  const ttlMs = env.PROSPECT_DISCOVERY_CACHE_TTL_MINUTES * 60_000;
  const cacheHit = Boolean(
    cached && Date.now() - cached.createdAt.getTime() < ttlMs
  );

  let discoveryResult: ProspectDiscoveryResult;
  if (cached && cacheHit) {
    discoveryResult = cached.result as unknown as ProspectDiscoveryResult;
  } else {
    const provider = new PerplexityGatewayDiscoveryProvider({ model });
    try {
      discoveryResult = await provider.search({
        businessType,
        location,
        resultLimit,
      });
    } catch (error) {
      const failureCode = resolveFailureCode(error);
      logger.error("discovery.search.failed", {
        userId,
        durationMs: Date.now() - started,
        failureCode,
      });
      return { status: "error", message: failureMessages[failureCode] };
    }

    if (discoveryResult.results.length > 0) {
      await database.prospectDiscoveryCache.upsert({
        where: { userId_cacheKey: { userId, cacheKey } },
        create: {
          userId,
          cacheKey,
          result: asJson(discoveryResult),
          inputTokens: discoveryResult.inputTokens,
          outputTokens: discoveryResult.outputTokens,
        },
        update: {
          result: asJson(discoveryResult),
          inputTokens: discoveryResult.inputTokens,
          outputTokens: discoveryResult.outputTokens,
          createdAt: new Date(),
        },
      });
    }
  }

  const duplicateProspectIds = await annotateDuplicates(
    userId,
    discoveryResult.results
  );

  logger.info("discovery.search.completed", {
    userId,
    cacheHit,
    durationMs: Date.now() - started,
    resultCount: discoveryResult.results.length,
    rejectedCount: discoveryResult.rejected.length,
    inputTokens: discoveryResult.inputTokens,
    outputTokens: discoveryResult.outputTokens,
  });

  return {
    status: "success",
    result: { ...discoveryResult, duplicateProspectIds },
  };
};

export interface ProspectImportBatchContext {
  location: string;
  provider: string;
  query: string;
  reasoningModel: string;
  requestedCount: number;
  returnedCount: number;
}

export type ImportProspectsResult =
  | {
      status: "success";
      imported: string[];
      skipped: string[];
      failed: Array<{ discoveryId: string; reason: string }>;
    }
  | { status: "error"; message: string };

// Persists a curated selection of discovery candidates as real Prospect
// rows. Never trusts anything the client claims about a candidate's
// preview-time status (duplicate/verification) -- both are re-derived here
// from the current database state, because the client's copy of a
// candidate can be stale (time has passed since the preview) or, in
// principle, tampered with in transit.
export const importProspects = async (
  candidates: DiscoveredProspect[],
  batchContext: ProspectImportBatchContext
): Promise<ImportProspectsResult> => {
  const userId = await authorize();
  if (!userId) {
    return { status: "error", message: "Not authorized." };
  }

  // The identity index is built once before the loop rather than refetched
  // per candidate. This is safe: no candidate within a single import batch
  // creates a Prospect that a *later* candidate in the same batch needs to
  // dedup against -- cross-candidate duplicates within one human-curated
  // selection are not a realistic concern. The idempotency requirement
  // this guards against is re-importing the same candidate across
  // *separate* calls, which is fully covered since this index is rebuilt
  // fresh from the database on every call to this action.
  const identityIndex = await fetchCurrentIdentityIndex(userId);

  const imported: string[] = [];
  const skipped: string[] = [];
  const failed: Array<{ discoveryId: string; reason: string }> = [];

  for (const candidate of candidates) {
    const duplicateId = findDuplicateForCandidate(candidate, identityIndex);
    if (duplicateId) {
      skipped.push(candidate.discoveryId);
      continue;
    }

    // Re-enforce website-verification eligibility server-side. A
    // candidate can never be legitimately verified without a non-blank
    // websiteUrl, so this checks both -- never trust a client-submitted
    // `websiteVerified: true` flag alone. `.trim()` matters: a
    // whitespace-only websiteUrl is truthy in JS but prospectSchema's
    // preprocess step normalizes it to null, so checking the raw string
    // would let a forged `{ websiteUrl: "   ", websiteVerified: true }`
    // candidate through with a null website.
    if (!(candidate.websiteUrl?.trim() && candidate.websiteVerified)) {
      failed.push({
        discoveryId: candidate.discoveryId,
        reason: "Website not verified",
      });
      continue;
    }

    const parsed = prospectSchema.safeParse({
      businessName: candidate.businessName,
      businessCategory: null,
      contactEmail: null,
      contactName: null,
      location: candidate.formattedAddress ?? null,
      notes: null,
      phone: candidate.phone ?? null,
      websiteUrl: candidate.websiteUrl,
    });
    if (!parsed.success) {
      failed.push({
        discoveryId: candidate.discoveryId,
        reason: parsed.error.issues.map((issue) => issue.message).join("; "),
      });
      continue;
    }

    try {
      const prospect = await database.prospect.create({
        data: {
          userId,
          ...parsed.data,
          sourceProvider: batchContext.provider,
          sourceExternalId: candidate.discoveryId,
          sourceUrls: asJson(candidate.sourceUrls),
          pipelineStage: "NEW",
        },
      });
      imported.push(prospect.id);
    } catch {
      logger.error("discovery.import.candidate_failed", {
        userId,
        discoveryId: candidate.discoveryId,
      });
      failed.push({
        discoveryId: candidate.discoveryId,
        reason: "Unable to save prospect.",
      });
    }
  }

  await database.prospectImportBatch.create({
    data: {
      userId,
      provider: batchContext.provider,
      reasoningModel: batchContext.reasoningModel,
      query: batchContext.query,
      location: batchContext.location,
      requestedCount: batchContext.requestedCount,
      returnedCount: batchContext.returnedCount,
      importedCount: imported.length,
      skippedCount: skipped.length,
      failedCount: failed.length,
    },
  });

  logger.info("discovery.import.completed", {
    userId,
    importedCount: imported.length,
    skippedCount: skipped.length,
    failedCount: failed.length,
  });

  return { status: "success", imported, skipped, failed };
};

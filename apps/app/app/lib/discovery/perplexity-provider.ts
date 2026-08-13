import { generateDiscovery } from "./generate";
import {
  hashIdentity,
  normalizeAddress,
  normalizeDomain,
  normalizeName,
} from "./normalize";
import { validateCandidate } from "./schema";
import type {
  DiscoveredProspect,
  ProspectDiscoveryInput,
  ProspectDiscoveryProvider,
  ProspectDiscoveryResult,
} from "./types";

export const deriveDiscoveryId = (candidate: {
  websiteUrl?: string;
  businessName: string;
  formattedAddress?: string;
}): string => {
  const domain = candidate.websiteUrl
    ? normalizeDomain(candidate.websiteUrl)
    : null;
  if (domain) {
    return domain;
  }
  return hashIdentity(
    `${normalizeName(candidate.businessName)}|${normalizeAddress(candidate.formattedAddress ?? "")}`
  );
};

export class PerplexityGatewayDiscoveryProvider
  implements ProspectDiscoveryProvider
{
  private readonly options: { model: string };

  constructor(options: { model: string }) {
    this.options = options;
  }

  async search(
    input: ProspectDiscoveryInput
  ): Promise<ProspectDiscoveryResult> {
    const generated = await generateDiscovery(input, {
      model: this.options.model,
    });
    const results: DiscoveredProspect[] = [];
    const rejected: Array<{ reason: string }> = [];

    for (const raw of generated.candidates) {
      const validated = validateCandidate(raw);
      if (!validated.ok) {
        rejected.push({ reason: validated.reason });
        continue;
      }
      const value = validated.value;
      results.push({
        discoveryId: deriveDiscoveryId(value),
        providerCandidateId: value.providerCandidateId,
        businessName: value.businessName,
        category: value.category,
        websiteUrl: value.websiteUrl,
        websiteVerified: Boolean(value.websiteUrl),
        phone: value.phone,
        formattedAddress: value.formattedAddress,
        city: value.city,
        state: value.state,
        sourceUrls: value.sourceUrls,
        confidence: value.confidence,
      });
    }

    return {
      results,
      rejected,
      query: input.businessType,
      location: input.location,
      provider: "PERPLEXITY_GATEWAY_SEARCH",
      reasoningModel: this.options.model,
      durationMs: generated.durationMs,
      inputTokens: generated.inputTokens,
      outputTokens: generated.outputTokens,
    };
  }
}

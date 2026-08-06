export interface ProspectDiscoveryInput {
  businessType: string;
  location: string;
  resultLimit: number;
}

export type DiscoveryConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface DiscoveredProspect {
  businessName: string;
  category?: string;
  city?: string;
  confidence: DiscoveryConfidence;
  discoveryId: string;
  formattedAddress?: string;
  phone?: string;
  providerCandidateId?: string;
  sourceUrls: string[];
  state?: string;
  websiteUrl?: string;
  websiteVerified: boolean;
}

export interface ProspectDiscoveryResult {
  durationMs: number;
  inputTokens?: number;
  location: string;
  outputTokens?: number;
  provider: string;
  query: string;
  reasoningModel: string;
  rejected: Array<{ reason: string }>;
  results: DiscoveredProspect[];
}

export interface ProspectDiscoveryProvider {
  search(input: ProspectDiscoveryInput): Promise<ProspectDiscoveryResult>;
}

export type OpportunityCategory = "accessibility" | "trust" | "seo" | "technical" | "performance";
export type RecommendationLevel = "HIGH" | "MEDIUM" | "LOW";

export interface OpportunityOutput {
  overallScore: number;
  categoryScores: Record<OpportunityCategory, number>;
  executiveSummary: string;
  overallRationale: string;
  recommendations: Array<{
    title: string;
    impact: RecommendationLevel;
    effort: RecommendationLevel;
    rationale: string;
    action: string;
    auditCheckKeys: string[];
  }>;
}

export type OpportunityCategory =
  | "accessibility"
  | "trust"
  | "seo"
  | "technical"
  | "performance";
export type RecommendationLevel = "HIGH" | "MEDIUM" | "LOW";

export interface RecommendationCopy {
  action: string;
  rationale: string;
  serviceCategory: string;
  title: string;
}

export interface InterpretationOutput {
  confidence: "HIGH" | "MEDIUM" | "LOW";
  practicalImpact: string;
  recommendations: RecommendationCopy[];
  strongestIssue: string;
  suggestedOffer: string;
  summary: string;
  warnings: string[];
}

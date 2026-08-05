import type { RecommendationCandidate } from "./recommend";
import type { ScoringResult } from "./scoring";

export const buildAllowedNumbers = (
  scoring: ScoringResult,
  recommendations: RecommendationCandidate[]
): string[] => {
  const numbers = new Set<string>();
  const add = (value: number) => numbers.add(String(value));

  // Universal bounds and small structural counts (recommendations.length
  // is always 0-2) that are safe to reference even though they aren't
  // literally one of the computed point values below.
  add(0);
  add(1);
  add(2);
  add(100);

  add(scoring.overallScore);
  for (const value of Object.values(scoring.categoryScores)) {
    add(value);
  }
  for (const entry of scoring.scoringBreakdown) {
    add(entry.points);
  }
  for (const reason of scoring.topReasons) {
    add(reason.points);
  }
  for (const candidate of recommendations) {
    add(candidate.weight);
  }
  return [...numbers];
};

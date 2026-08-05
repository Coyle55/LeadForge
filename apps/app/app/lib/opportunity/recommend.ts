import {
  APPOINTMENT_DRIVEN_CATEGORIES,
  BOOKING_WEIGHT_MULTIPLIER,
} from "./scoring-rules";
import {
  AFTER_HOURS_COMBINATION,
  RECOMMENDATION_THRESHOLD,
  SERVICE_EFFORT,
  SIGNAL_RULES,
  type ServiceCategory,
} from "./recommendation-rules";
import type { ScoringCheckInput } from "./scoring";

export interface RecommendationCandidate {
  confidence: "HIGH" | "MEDIUM" | "LOW";
  effort: "HIGH" | "MEDIUM" | "LOW";
  impact: "HIGH" | "MEDIUM" | "LOW";
  serviceCategory: ServiceCategory;
  supportingCheckKeys: string[];
  weight: number;
}

const confidenceFor = (weight: number): "HIGH" | "MEDIUM" | "LOW" => {
  if (weight >= 6) {
    return "HIGH";
  }
  if (weight >= 4) {
    return "MEDIUM";
  }
  return "LOW";
};

const impactFor = confidenceFor;

export const selectRecommendations = (
  checks: ScoringCheckInput[],
  businessCategory: string | null
): RecommendationCandidate[] => {
  const byKey = new Map(checks.map((c) => [c.key, c.status]));
  const isAppointmentDriven =
    businessCategory !== null && APPOINTMENT_DRIVEN_CATEGORIES.has(businessCategory);

  const weightByService = new Map<ServiceCategory, number>();
  const checksByService = new Map<ServiceCategory, Set<string>>();
  const add = (service: ServiceCategory, weight: number, checkKey: string) => {
    if (weight <= 0) {
      return;
    }
    weightByService.set(service, (weightByService.get(service) ?? 0) + weight);
    const keys = checksByService.get(service) ?? new Set<string>();
    keys.add(checkKey);
    checksByService.set(service, keys);
  };

  for (const rule of SIGNAL_RULES) {
    const status = byKey.get(rule.checkKey);
    if (!status) {
      continue;
    }
    let weight = rule.statuses[status] ?? 0;
    if (rule.checkKey === "booking_detection" && isAppointmentDriven) {
      weight *= BOOKING_WEIGHT_MULTIPLIER;
    }
    add(rule.service, weight, rule.checkKey);
  }

  const gatePassed = AFTER_HOURS_COMBINATION.gate.every((key) => byKey.get(key) === "FAIL");
  const eitherPassed = AFTER_HOURS_COMBINATION.either.some((key) => byKey.get(key) === "FAIL");
  if (gatePassed && eitherPassed) {
    for (const key of [...AFTER_HOURS_COMBINATION.gate, ...AFTER_HOURS_COMBINATION.either]) {
      if (byKey.get(key) === "FAIL") {
        add(AFTER_HOURS_COMBINATION.service, AFTER_HOURS_COMBINATION.weight, key);
        break;
      }
    }
  }

  const candidates: RecommendationCandidate[] = [...weightByService.entries()]
    .map(([serviceCategory, weight]) => ({
      serviceCategory,
      weight,
      effort: SERVICE_EFFORT[serviceCategory],
      impact: impactFor(weight),
      confidence: confidenceFor(weight),
      supportingCheckKeys: [...(checksByService.get(serviceCategory) ?? [])],
    }))
    .sort((a, b) => b.weight - a.weight);

  const qualifying = candidates.filter((c) => c.weight >= RECOMMENDATION_THRESHOLD);
  if (qualifying.length > 0) {
    return qualifying.slice(0, 2);
  }
  return candidates.length > 0 ? [candidates[0]] : [];
};

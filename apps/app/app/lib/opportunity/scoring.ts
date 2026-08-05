import {
  APPOINTMENT_DRIVEN_CATEGORIES,
  BOOKING_WEIGHT_MULTIPLIER,
  CATEGORY_CAPS,
  CATEGORY_MAX_POSSIBLE,
  type CheckStatus,
  getCategoryCap,
  NEGATIVE_MODIFIERS,
  POINT_TABLE,
} from "./scoring-rules";

export type Tier = "EXCELLENT" | "HIGH" | "MEDIUM" | "LOW";
export type Disqualifier = "AUDIT_INCOMPLETE" | "SITE_UNREACHABLE";

export interface ScoringCheckInput {
  category: string;
  evidence: unknown;
  key: string;
  status: CheckStatus;
}

export interface ScoringInput {
  businessCategory: string | null;
  checks: ScoringCheckInput[];
  pagesAudited: number;
}

export interface ScoringBreakdownEntry {
  category: string;
  checkKey: string;
  points: number;
}

export interface TopReason extends ScoringBreakdownEntry {
  evidence: unknown;
}

export interface ScoringResult {
  categoryScores: Record<string, number>;
  disqualifiers: Disqualifier[];
  overallScore: number;
  scoringBreakdown: ScoringBreakdownEntry[];
  tier: Tier;
  topReasons: TopReason[];
}

const tierFor = (score: number): Tier => {
  if (score >= 80) {
    return "EXCELLENT";
  }
  if (score >= 60) {
    return "HIGH";
  }
  if (score >= 30) {
    return "MEDIUM";
  }
  return "LOW";
};

const detectDisqualifiers = (input: ScoringInput): Disqualifier[] => {
  const disqualifiers: Disqualifier[] = [];
  if (input.pagesAudited === 0) {
    disqualifiers.push("AUDIT_INCOMPLETE");
  }
  const httpChecks = input.checks.filter((c) => c.key === "http_status");
  if (httpChecks.length > 0 && httpChecks.every((c) => c.status === "FAIL")) {
    disqualifiers.push("SITE_UNREACHABLE");
  }
  return disqualifiers;
};

export const computeOpportunityScore = (input: ScoringInput): ScoringResult => {
  const disqualifiers = detectDisqualifiers(input);
  if (disqualifiers.length > 0) {
    return {
      tier: "LOW",
      overallScore: 0,
      categoryScores: {},
      scoringBreakdown: [],
      topReasons: [],
      disqualifiers,
    };
  }

  const byKey = new Map(
    input.checks.map((c) => [c.key, { status: c.status, evidence: c.evidence }])
  );
  const isAppointmentDriven =
    input.businessCategory !== null &&
    APPOINTMENT_DRIVEN_CATEGORIES.has(input.businessCategory);

  const breakdown: ScoringBreakdownEntry[] = [];
  const topReasons: TopReason[] = [];
  const rawByCategory: Record<string, number> = {};

  for (const check of input.checks) {
    const rule = POINT_TABLE[check.key];
    if (!rule) {
      continue;
    }
    let points =
      check.status === "FAIL"
        ? (rule.fail ?? 0)
        : check.status === "WARNING"
          ? (rule.warning ?? 0)
          : 0;
    if (points === 0) {
      continue;
    }
    if (check.key === "booking_detection" && isAppointmentDriven) {
      points *= BOOKING_WEIGHT_MULTIPLIER;
    }
    rawByCategory[check.category] =
      (rawByCategory[check.category] ?? 0) + points;
    breakdown.push({ checkKey: check.key, category: check.category, points });
    topReasons.push({
      checkKey: check.key,
      category: check.category,
      points,
      evidence: check.evidence,
    });
  }

  for (const modifier of NEGATIVE_MODIFIERS) {
    if (modifier.matches(byKey)) {
      rawByCategory[modifier.category] = Math.max(
        0,
        (rawByCategory[modifier.category] ?? 0) - modifier.points
      );
    }
  }

  const categoryScores: Record<string, number> = {};
  let overallScore = 0;
  for (const category of Object.keys(CATEGORY_CAPS)) {
    const raw = rawByCategory[category] ?? 0;
    const maxPossible = CATEGORY_MAX_POSSIBLE[category] ?? 1;
    categoryScores[category.toLowerCase()] = Math.min(
      100,
      Math.round((raw / maxPossible) * 100)
    );
    overallScore += Math.min(
      raw,
      getCategoryCap(category, isAppointmentDriven)
    );
  }
  overallScore = Math.min(100, Math.round(overallScore));

  topReasons.sort((a, b) => b.points - a.points);

  return {
    tier: tierFor(overallScore),
    overallScore,
    categoryScores,
    scoringBreakdown: breakdown,
    topReasons: topReasons.slice(0, 5),
    disqualifiers: [],
  };
};

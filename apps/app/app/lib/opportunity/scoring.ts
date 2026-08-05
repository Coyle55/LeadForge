import {
  APPOINTMENT_DRIVEN_CATEGORIES,
  BOOKING_WEIGHT_MULTIPLIER,
  CATEGORY_CAPS,
  CATEGORY_MAX_POSSIBLE,
  type CheckStatus,
  getCategoryCap,
  NEGATIVE_MODIFIERS,
  POINT_TABLE,
  type PointRule,
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

// Resolves the raw point value for a single check from its POINT_TABLE
// rule, then applies the appointment-driven booking multiplier when
// applicable. Written as a plain if/else chain (matching the status
// branching style used in packages/audit-engine/checks.ts) rather than a
// nested ternary.
const pointsForCheck = (
  check: ScoringCheckInput,
  rule: PointRule,
  isAppointmentDriven: boolean
): number => {
  let points: number;
  if (check.status === "FAIL") {
    points = rule.fail ?? 0;
  } else if (check.status === "WARNING") {
    points = rule.warning ?? 0;
  } else {
    points = 0;
  }
  if (
    points !== 0 &&
    check.key === "booking_detection" &&
    isAppointmentDriven
  ) {
    points *= BOOKING_WEIGHT_MULTIPLIER;
  }
  return points;
};

interface CheckPointAccumulation {
  breakdown: ScoringBreakdownEntry[];
  rawByCategory: Record<string, number>;
  topReasons: TopReason[];
}

// Walks every audit check, resolves its point value, and accumulates the
// per-category raw totals plus the breakdown/topReasons rows used later
// in the result. Skips checks with no scoring rule or a zero point value.
const accumulateCheckPoints = (
  checks: ScoringCheckInput[],
  isAppointmentDriven: boolean
): CheckPointAccumulation => {
  const breakdown: ScoringBreakdownEntry[] = [];
  const topReasons: TopReason[] = [];
  const rawByCategory: Record<string, number> = {};

  for (const check of checks) {
    const rule = POINT_TABLE[check.key];
    if (!rule) {
      continue;
    }
    const points = pointsForCheck(check, rule, isAppointmentDriven);
    if (points === 0) {
      continue;
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

  return { breakdown, rawByCategory, topReasons };
};

// Applies each configured negative modifier (e.g. penalizing a category
// when an unrelated check passed in a way that undercuts it) directly
// against the mutable raw-category totals, floored at zero.
const applyNegativeModifiers = (
  rawByCategory: Record<string, number>,
  byKey: Map<string, { evidence: unknown; status: CheckStatus }>
): void => {
  for (const modifier of NEGATIVE_MODIFIERS) {
    if (modifier.matches(byKey)) {
      rawByCategory[modifier.category] = Math.max(
        0,
        (rawByCategory[modifier.category] ?? 0) - modifier.points
      );
    }
  }
};

interface CategoryScoreAssembly {
  categoryScores: Record<string, number>;
  overallScore: number;
}

// Converts the raw per-category totals into the 0-100 categoryScores map
// and the capped, rounded overall score.
const buildCategoryScoreAssembly = (
  rawByCategory: Record<string, number>,
  isAppointmentDriven: boolean
): CategoryScoreAssembly => {
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
  return { categoryScores, overallScore };
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

  const { breakdown, rawByCategory, topReasons } = accumulateCheckPoints(
    input.checks,
    isAppointmentDriven
  );

  applyNegativeModifiers(rawByCategory, byKey);

  const { categoryScores, overallScore } = buildCategoryScoreAssembly(
    rawByCategory,
    isAppointmentDriven
  );

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

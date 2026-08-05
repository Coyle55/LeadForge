# Phase 2 Website Intelligence Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace AI-generated opportunity scoring with a deterministic, evidence-traceable rules engine; add the remaining audit checks; add an explicit, human-controlled outreach "mark sent" and follow-up-task-suggestion flow.

**Architecture:** Everything stays inside `apps/app` with Prisma/PostgreSQL, matching every prior milestone. Scoring and recommendation selection become pure, synchronous functions with zero AI involvement. The AI call that remains is bounded to interpreting an already-computed score — it receives the score/breakdown/recommendations as input and can never introduce a number that isn't already there.

**Tech Stack:** Next.js 16 App Router, React 19 Server Components/server actions, Clerk, Prisma 7 with `@prisma/adapter-pg`, PostgreSQL, Zod 4, Vitest 4, Bun, Biome/Ultracite, Vercel AI SDK (`ai` package, `generateText` + `Output.object`)

## Global Constraints

- Scoring is a pure function of persisted `AuditCheck` rows — no AI, no network, no non-determinism. Identical inputs always produce identical output.
- Category caps: Trust 50, Technical 45, Performance 25, Booking 8 (16 for appointment-driven business categories), Accessibility 12, SEO 8, Freshness 2. `overallScore = min(100, sum of capped category totals)`.
- Tiers: Excellent 80–100, High 60–79, Medium 30–59, Low 0–29.
- Disqualifiers (`AUDIT_INCOMPLETE` when `pagesAudited === 0`; `SITE_UNREACHABLE` when every attempted page failed `http_status`) skip scoring/recommendations entirely.
- Recommendation weights sum per service; keep services scoring ≥3, sorted descending, capped at top 2; if none clear 3 but at least one signal fired, keep the single highest-weighted service.
- Confidence: ≥6 total weight → HIGH, 4–5 → MEDIUM, 3 → LOW.
- The AI interpretation layer never selects a service or computes a number — it receives the finished deterministic output and returns only prose (`summary`, `strongestIssue`, `practicalImpact`, `suggestedOffer`, `confidence`, `warnings`).
- Screenshot capture is deferred: a `ScreenshotProvider` interface with a single no-op implementation returning `{ status: "unavailable", reason: "not_configured" }`. Never introduce Browserbase, Kernel, or any paid browser-automation vendor in this plan.
- `businessCategory` is manually set by the owner — no automated classification. Appointment-driven categories (`SALON_SPA`, `MEDICAL_DENTAL`, `FITNESS`, `AUTOMOTIVE`, `LEGAL_FINANCIAL`) double the booking weight in both scoring and recommendations.
- Marking outreach sent never regresses `Prospect.pipelineStage` from `INTERESTED`, `PROPOSAL`, `WON`, or `LOST`; it only advances `NEW` → `CONTACTED`.
- Follow-up tasks are always the result of explicit owner action — never auto-created, matching M5's task-creation principle.
- Derive owner ID exclusively from `auth()`; every query and mutation is owner-scoped.
- Do not add screenshot infrastructure, new top-level pages, dashboard widgets, background job queues, automated sending, or discovery/scraping providers.

---

### Task 1: Deterministic scoring engine

**Files:**
- Create: `apps/app/app/lib/opportunity/scoring-rules.ts`
- Create: `apps/app/app/lib/opportunity/scoring.ts`
- Create: `apps/app/app/lib/opportunity/scoring.test.ts`

**Interfaces:**
- Produces: `ScoringInput` (`{ checks: Array<{ key: string; category: string; status: "PASS"|"WARNING"|"FAIL"; evidence: unknown }>; pagesAudited: number; businessCategory: string | null }`), `ScoringResult` (`{ tier: "EXCELLENT"|"HIGH"|"MEDIUM"|"LOW"; overallScore: number; categoryScores: Record<string, number>; scoringBreakdown: Array<{ checkKey: string; category: string; points: number }>; topReasons: Array<{ checkKey: string; category: string; points: number; evidence: unknown }>; disqualifiers: Array<"AUDIT_INCOMPLETE"|"SITE_UNREACHABLE"> }`), `computeOpportunityScore(input: ScoringInput): ScoringResult`.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import { computeOpportunityScore } from "./scoring";

const check = (
  key: string,
  category: string,
  status: "PASS" | "WARNING" | "FAIL",
  evidence: unknown = {}
) => ({ key, category, status, evidence });

describe("computeOpportunityScore", () => {
  it("is a pure function: identical inputs produce identical output", () => {
    const input = {
      checks: [check("https", "TRUST", "FAIL"), check("http_status", "TECHNICAL", "PASS")],
      pagesAudited: 3,
      businessCategory: null,
    };
    expect(computeOpportunityScore(input)).toEqual(computeOpportunityScore(input));
  });

  it("caps accessibility and SEO so cosmetic findings alone cannot reach a competitive tier", () => {
    const result = computeOpportunityScore({
      checks: [
        check("page_title", "ACCESSIBILITY", "FAIL"),
        check("heading_structure", "ACCESSIBILITY", "FAIL"),
        check("meta_description", "ACCESSIBILITY", "FAIL"),
        check("image_alt_coverage", "ACCESSIBILITY", "FAIL"),
        check("form_label_coverage", "ACCESSIBILITY", "FAIL"),
        check("document_language", "ACCESSIBILITY", "FAIL"),
        check("robots_meta", "SEO", "FAIL"),
        check("canonical_url", "SEO", "FAIL"),
        check("robots_txt", "SEO", "WARNING"),
        check("sitemap", "SEO", "WARNING"),
        check("structured_data", "SEO", "WARNING"),
      ],
      pagesAudited: 1,
      businessCategory: null,
    });
    expect(result.overallScore).toBeLessThan(30);
    expect(result.tier).toBe("LOW");
  });

  it("applies negative modifiers for strong existing implementations, floored at zero", () => {
    const healthy = computeOpportunityScore({
      checks: [
        check("contact_path", "TRUST", "PASS"),
        check("phone_detection", "TRUST", "PASS"),
        check("email_detection", "TRUST", "PASS"),
        check("calls_to_action", "TRUST", "PASS"),
        check("booking_detection", "BOOKING", "PASS"),
      ],
      pagesAudited: 1,
      businessCategory: null,
    });
    expect(healthy.categoryScores.trust).toBe(0);
    expect(healthy.categoryScores.booking).toBe(0);
    expect(healthy.overallScore).toBe(0);
  });

  it("doubles booking weight for appointment-driven business categories", () => {
    const base = computeOpportunityScore({
      checks: [check("booking_detection", "BOOKING", "FAIL")],
      pagesAudited: 1,
      businessCategory: null,
    });
    const salon = computeOpportunityScore({
      checks: [check("booking_detection", "BOOKING", "FAIL")],
      pagesAudited: 1,
      businessCategory: "SALON_SPA",
    });
    expect(base.categoryScores.booking).toBe(100);
    expect(salon.categoryScores.booking).toBe(100);
    expect(salon.overallScore).toBeGreaterThan(base.overallScore);
  });

  it("resolves conflicting signals within one category (partial credit)", () => {
    const result = computeOpportunityScore({
      checks: [
        check("https", "TRUST", "FAIL"),
        check("privacy_policy", "TRUST", "PASS"),
        check("calls_to_action", "TRUST", "PASS"),
      ],
      pagesAudited: 1,
      businessCategory: null,
    });
    expect(result.categoryScores.trust).toBeGreaterThan(0);
    expect(result.categoryScores.trust).toBeLessThan(100);
  });

  it("flags AUDIT_INCOMPLETE and skips scoring when no pages were audited", () => {
    const result = computeOpportunityScore({ checks: [], pagesAudited: 0, businessCategory: null });
    expect(result.disqualifiers).toContain("AUDIT_INCOMPLETE");
    expect(result.overallScore).toBe(0);
    expect(result.scoringBreakdown).toEqual([]);
  });

  it("flags SITE_UNREACHABLE when every http_status check failed", () => {
    const result = computeOpportunityScore({
      checks: [
        check("http_status", "TECHNICAL", "FAIL"),
        check("https", "TRUST", "FAIL"),
      ],
      pagesAudited: 1,
      businessCategory: null,
    });
    expect(result.disqualifiers).toContain("SITE_UNREACHABLE");
  });

  it("orders top reasons by point contribution descending, capped at 5", () => {
    // Deliberately excludes http_status: a FAILed http_status check means
    // every page in the crawl returned a non-2xx status, which is exactly
    // the SITE_UNREACHABLE disqualifier condition tested above — including
    // it here would disqualify this input instead of scoring it normally.
    const result = computeOpportunityScore({
      checks: [
        check("contact_path", "TRUST", "FAIL"), // 15
        check("viewport_meta", "TECHNICAL", "FAIL"), // 12
        check("calls_to_action", "TRUST", "FAIL"), // 10
        check("booking_detection", "BOOKING", "FAIL"), // 8
        check("page_title", "ACCESSIBILITY", "FAIL"), // 3
      ],
      pagesAudited: 1,
      businessCategory: null,
    });
    expect(result.topReasons).toHaveLength(5);
    expect(result.topReasons[0].checkKey).toBe("contact_path");
    const points = result.topReasons.map((r) => r.points);
    expect([...points]).toEqual([...points].sort((a, b) => b - a));
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `bun run test apps/app/app/lib/opportunity/scoring.test.ts`
Expected: FAIL because `./scoring` and `./scoring-rules` do not exist.

- [ ] **Step 3: Implement the rule table**

```ts
// scoring-rules.ts
export type CheckStatus = "PASS" | "WARNING" | "FAIL";

export interface PointRule {
  warning?: number;
  fail?: number;
}

export const CATEGORY_CAPS: Record<string, number> = {
  TRUST: 50,
  TECHNICAL: 45,
  PERFORMANCE: 25,
  BOOKING: 8,
  ACCESSIBILITY: 12,
  SEO: 8,
  FRESHNESS: 2,
};

// The BOOKING cap doubles for appointment-driven businesses, matching the
// booking_detection point-value multiplier below. Without this, the raw
// fail value (8) already equals the base cap (8), so doubling the raw
// points before capping would have zero effect on overallScore — the cap
// must scale with the multiplier for it to mean anything.
export const getCategoryCap = (category: string, isAppointmentDriven: boolean): number =>
  category === "BOOKING" && isAppointmentDriven ? 16 : CATEGORY_CAPS[category];

export const CATEGORY_MAX_POSSIBLE: Record<string, number> = {
  TRUST: 20 + 15 + 10 + 5 + 3 + 10 + 8,
  TECHNICAL: 30 + 12 + 8 + 6 + 5 + 6,
  PERFORMANCE: 8 + 6 + 4 + 4 + 4,
  BOOKING: 8,
  ACCESSIBILITY: 3 + 3 + 2 + 2 + 2 + 1,
  SEO: 3 + 2 + 1 + 1 + 1,
  FRESHNESS: 2,
};

export const POINT_TABLE: Record<string, PointRule> = {
  https: { warning: 10, fail: 20 },
  contact_path: { fail: 15 },
  calls_to_action: { warning: 6, fail: 10 },
  privacy_policy: { warning: 3, fail: 5 },
  terms_link: { warning: 2, fail: 3 },
  phone_detection: { fail: 10 },
  email_detection: { fail: 8 },
  http_status: { warning: 15, fail: 30 },
  viewport_meta: { fail: 12 },
  broken_internal_links: { warning: 4, fail: 8 },
  redirect_chain: { warning: 3, fail: 6 },
  mixed_content: { fail: 5 },
  broken_images: { warning: 3, fail: 6 },
  server_response_time: { warning: 4, fail: 8 },
  render_blocking_resources: { warning: 3, fail: 6 },
  html_size: { warning: 2, fail: 4 },
  image_count: { warning: 2, fail: 4 },
  script_count: { warning: 2, fail: 4 },
  booking_detection: { fail: 8 },
  page_title: { warning: 1, fail: 3 },
  heading_structure: { warning: 1, fail: 3 },
  meta_description: { warning: 1, fail: 2 },
  image_alt_coverage: { warning: 1, fail: 2 },
  form_label_coverage: { warning: 1, fail: 2 },
  document_language: { fail: 1 },
  robots_meta: { warning: 1, fail: 3 },
  canonical_url: { warning: 1, fail: 2 },
  robots_txt: { warning: 1 },
  sitemap: { warning: 1 },
  structured_data: { warning: 1 },
  copyright_year: { warning: 2, fail: 2 },
};

export const APPOINTMENT_DRIVEN_CATEGORIES = new Set([
  "SALON_SPA",
  "MEDICAL_DENTAL",
  "FITNESS",
  "AUTOMOTIVE",
  "LEGAL_FINANCIAL",
]);

export const BOOKING_WEIGHT_MULTIPLIER = 2;

export interface NegativeModifierRule {
  category: string;
  points: number;
  matches: (checksByKey: Map<string, { status: CheckStatus; evidence: unknown }>) => boolean;
}

export const NEGATIVE_MODIFIERS: NegativeModifierRule[] = [
  {
    category: "PERFORMANCE",
    points: 3,
    matches: (byKey) => {
      const check = byKey.get("server_response_time");
      const ms =
        check?.evidence &&
        typeof check.evidence === "object" &&
        "milliseconds" in (check.evidence as Record<string, unknown>)
          ? Number((check.evidence as Record<string, unknown>).milliseconds)
          : undefined;
      return check?.status === "PASS" && typeof ms === "number" && ms < 300;
    },
  },
  {
    category: "TRUST",
    points: 4,
    matches: (byKey) =>
      byKey.get("contact_path")?.status === "PASS" &&
      byKey.get("phone_detection")?.status === "PASS" &&
      byKey.get("email_detection")?.status === "PASS",
  },
  {
    category: "TRUST",
    points: 2,
    matches: (byKey) => byKey.get("calls_to_action")?.status === "PASS",
  },
  {
    category: "BOOKING",
    points: 4,
    matches: (byKey) => byKey.get("booking_detection")?.status === "PASS",
  },
];
```

`CATEGORY_MAX_POSSIBLE` is the sum of every `fail` value in that category from `POINT_TABLE` — used only to normalize `categoryScores` to a 0-100 reading independent of the cross-category cap.

- [ ] **Step 4: Implement `computeOpportunityScore`**

```ts
// scoring.ts
import {
  APPOINTMENT_DRIVEN_CATEGORIES,
  BOOKING_WEIGHT_MULTIPLIER,
  CATEGORY_CAPS,
  CATEGORY_MAX_POSSIBLE,
  getCategoryCap,
  NEGATIVE_MODIFIERS,
  POINT_TABLE,
  type CheckStatus,
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
      check.status === "FAIL" ? (rule.fail ?? 0) : check.status === "WARNING" ? (rule.warning ?? 0) : 0;
    if (points === 0) {
      continue;
    }
    if (check.key === "booking_detection" && isAppointmentDriven) {
      points *= BOOKING_WEIGHT_MULTIPLIER;
    }
    rawByCategory[check.category] = (rawByCategory[check.category] ?? 0) + points;
    breakdown.push({ checkKey: check.key, category: check.category, points });
    topReasons.push({ checkKey: check.key, category: check.category, points, evidence: check.evidence });
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
    categoryScores[category.toLowerCase()] = Math.min(100, Math.round((raw / maxPossible) * 100));
    overallScore += Math.min(raw, getCategoryCap(category, isAppointmentDriven));
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
```

- [ ] **Step 5: Run tests and verify GREEN**

Run: `bun run test apps/app/app/lib/opportunity/scoring.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/app/app/lib/opportunity/scoring-rules.ts apps/app/app/lib/opportunity/scoring.ts apps/app/app/lib/opportunity/scoring.test.ts
git commit -m "feat: add deterministic opportunity scoring engine"
```

---

### Task 2: Deterministic recommendation engine

**Files:**
- Create: `apps/app/app/lib/opportunity/recommendation-rules.ts`
- Create: `apps/app/app/lib/opportunity/recommend.ts`
- Create: `apps/app/app/lib/opportunity/recommend.test.ts`

**Interfaces:**
- Consumes: `ScoringCheckInput`, `APPOINTMENT_DRIVEN_CATEGORIES`, `BOOKING_WEIGHT_MULTIPLIER` from `./scoring` / `./scoring-rules` (Task 1).
- Produces: `ServiceCategory` (`"WEBSITE_REDESIGN"|"PERFORMANCE_OPTIMIZATION"|"BOOKING_INTEGRATION"|"LEAD_CAPTURE_REPAIR"|"LEAD_RESPONSE_AUTOMATION"`), `RecommendationCandidate` (`{ serviceCategory: ServiceCategory; weight: number; effort: "HIGH"|"MEDIUM"|"LOW"; impact: "HIGH"|"MEDIUM"|"LOW"; confidence: "HIGH"|"MEDIUM"|"LOW"; supportingCheckKeys: string[] }`), `selectRecommendations(checks: ScoringCheckInput[], businessCategory: string | null): RecommendationCandidate[]`.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import { selectRecommendations } from "./recommend";

const check = (key: string, category: string, status: "PASS" | "WARNING" | "FAIL") => ({
  key,
  category,
  status,
  evidence: {},
});

describe("selectRecommendations", () => {
  it("returns nothing when every check passes", () => {
    expect(
      selectRecommendations(
        [check("calls_to_action", "TRUST", "PASS"), check("booking_detection", "BOOKING", "PASS")],
        null
      )
    ).toEqual([]);
  });

  it("keeps services scoring at least 3, sorted descending, capped at 2", () => {
    const result = selectRecommendations(
      [
        check("calls_to_action", "TRUST", "FAIL"), // 3 -> website redesign
        check("viewport_meta", "TECHNICAL", "FAIL"), // 3 -> website redesign (total 6)
        check("server_response_time", "PERFORMANCE", "FAIL"), // 3 -> performance
        check("contact_path", "TRUST", "FAIL"), // 2 -> lead-capture (below threshold alone)
      ],
      null
    );
    expect(result).toHaveLength(2);
    expect(result[0].serviceCategory).toBe("WEBSITE_REDESIGN");
    expect(result[0].weight).toBe(6);
    expect(result.map((r) => r.serviceCategory)).not.toContain("LEAD_CAPTURE_REPAIR");
  });

  it("keeps the single highest-weighted service when nothing clears the threshold", () => {
    const result = selectRecommendations([check("email_detection", "TRUST", "FAIL")], null);
    expect(result).toHaveLength(1);
    expect(result[0].serviceCategory).toBe("LEAD_CAPTURE_REPAIR");
    expect(result[0].weight).toBe(1);
  });

  it("doubles booking weight for appointment-driven categories", () => {
    const base = selectRecommendations([check("booking_detection", "BOOKING", "FAIL")], null);
    const salon = selectRecommendations([check("booking_detection", "BOOKING", "FAIL")], "SALON_SPA");
    expect(base[0].weight).toBe(3);
    expect(salon[0].weight).toBe(6);
  });

  it("derives confidence from total weight", () => {
    const high = selectRecommendations(
      [check("calls_to_action", "TRUST", "FAIL"), check("viewport_meta", "TECHNICAL", "FAIL"), check("broken_internal_links", "TECHNICAL", "FAIL")],
      null
    );
    expect(high[0].weight).toBeGreaterThanOrEqual(6);
    expect(high[0].confidence).toBe("HIGH");
  });

  it("combines booking and contact gaps into a lead-response-automation signal", () => {
    const result = selectRecommendations(
      [check("booking_detection", "BOOKING", "FAIL"), check("phone_detection", "TRUST", "FAIL")],
      null
    );
    expect(result.some((r) => r.serviceCategory === "LEAD_RESPONSE_AUTOMATION")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `bun run test apps/app/app/lib/opportunity/recommend.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the mapping table**

```ts
// recommendation-rules.ts
import type { CheckStatus } from "./scoring-rules";

export type ServiceCategory =
  | "WEBSITE_REDESIGN"
  | "PERFORMANCE_OPTIMIZATION"
  | "BOOKING_INTEGRATION"
  | "LEAD_CAPTURE_REPAIR"
  | "LEAD_RESPONSE_AUTOMATION";

export const RECOMMENDATION_THRESHOLD = 3;

export const SERVICE_EFFORT: Record<ServiceCategory, "HIGH" | "MEDIUM" | "LOW"> = {
  WEBSITE_REDESIGN: "HIGH",
  PERFORMANCE_OPTIMIZATION: "MEDIUM",
  BOOKING_INTEGRATION: "MEDIUM",
  LEAD_CAPTURE_REPAIR: "LOW",
  LEAD_RESPONSE_AUTOMATION: "MEDIUM",
};

interface SignalRule {
  checkKey: string;
  service: ServiceCategory;
  statuses: Partial<Record<CheckStatus, number>>;
}

export const SIGNAL_RULES: SignalRule[] = [
  { checkKey: "calls_to_action", service: "WEBSITE_REDESIGN", statuses: { WARNING: 2, FAIL: 3 } },
  { checkKey: "viewport_meta", service: "WEBSITE_REDESIGN", statuses: { FAIL: 3 } },
  { checkKey: "broken_internal_links", service: "WEBSITE_REDESIGN", statuses: { FAIL: 2 } },
  { checkKey: "broken_images", service: "WEBSITE_REDESIGN", statuses: { FAIL: 1 } },
  { checkKey: "mixed_content", service: "WEBSITE_REDESIGN", statuses: { FAIL: 1 } },
  { checkKey: "server_response_time", service: "PERFORMANCE_OPTIMIZATION", statuses: { WARNING: 2, FAIL: 3 } },
  { checkKey: "render_blocking_resources", service: "PERFORMANCE_OPTIMIZATION", statuses: { FAIL: 1 } },
  { checkKey: "html_size", service: "PERFORMANCE_OPTIMIZATION", statuses: { FAIL: 1 } },
  { checkKey: "script_count", service: "PERFORMANCE_OPTIMIZATION", statuses: { FAIL: 1 } },
  { checkKey: "booking_detection", service: "BOOKING_INTEGRATION", statuses: { FAIL: 3 } },
  { checkKey: "contact_path", service: "LEAD_CAPTURE_REPAIR", statuses: { FAIL: 2 } },
  { checkKey: "phone_detection", service: "LEAD_CAPTURE_REPAIR", statuses: { FAIL: 2 } },
  { checkKey: "email_detection", service: "LEAD_CAPTURE_REPAIR", statuses: { FAIL: 1 } },
];

// Weight is 3 (not 2) so this signal independently clears
// RECOMMENDATION_THRESHOLD on its own. At weight 2 it can never appear in
// the final selection whenever booking_detection FAIL also fires the plain
// BOOKING_INTEGRATION signal (weight 3) in the same input, because that
// service alone already satisfies the threshold and the "qualifying"
// early-return in selectRecommendations never falls through to consider a
// sub-threshold candidate — so the two service categories most likely to
// co-occur (this one always requires booking_detection FAIL as its gate)
// would otherwise be structurally unable to appear together.
export const AFTER_HOURS_COMBINATION = {
  gate: ["booking_detection"],
  either: ["phone_detection", "email_detection"],
  service: "LEAD_RESPONSE_AUTOMATION" as ServiceCategory,
  weight: 3,
};
```

- [ ] **Step 4: Implement `selectRecommendations`**

```ts
// recommend.ts
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
```

- [ ] **Step 5: Run tests and verify GREEN**

Run: `bun run test apps/app/app/lib/opportunity/recommend.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/app/app/lib/opportunity/recommendation-rules.ts apps/app/app/lib/opportunity/recommend.ts apps/app/app/lib/opportunity/recommend.test.ts
git commit -m "feat: add deterministic recommendation engine"
```

---

### Task 3: Schema changes

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260805060000_phase2_intelligence_pipeline/migration.sql`

**Interfaces:**
- Produces: `OpportunityTier`, `ScoringConfidence`, `ScoringMethod`, `ServiceCategory`, `BusinessCategory`, `ProspectActivityType` enums; `ProspectActivity` model; new fields on `OpportunityAnalysis`, `OpportunityRecommendation`, `Prospect`, `WebsiteAudit`, `OutreachDraft`; extended `OutreachDraftStatus`.

- [ ] **Step 1: Add enums and fields to schema.prisma**

```prisma
enum OpportunityTier {
  EXCELLENT
  HIGH
  MEDIUM
  LOW
}

enum ScoringConfidence {
  HIGH
  MEDIUM
  LOW
}

enum ScoringMethod {
  AI_LEGACY
  DETERMINISTIC
}

enum ServiceCategory {
  WEBSITE_REDESIGN
  PERFORMANCE_OPTIMIZATION
  BOOKING_INTEGRATION
  LEAD_CAPTURE_REPAIR
  LEAD_RESPONSE_AUTOMATION
}

enum BusinessCategory {
  SALON_SPA
  MEDICAL_DENTAL
  HOME_SERVICES
  AUTOMOTIVE
  FITNESS
  LEGAL_FINANCIAL
  RESTAURANT_FOOD
  RETAIL
  PROFESSIONAL_SERVICES
  OTHER
}

enum ProspectActivityType {
  OUTREACH_SENT
}
```

In `model OpportunityAnalysis`, add: `tier OpportunityTier?`, `scoringBreakdown Json?`, `topReasons Json?`, `disqualifiers Json?`, `strongestIssue String?`, `suggestedOffer String?`, `confidence ScoringConfidence?`, `warnings Json?`, `scoringMethod ScoringMethod @default(DETERMINISTIC)`.

In `model OpportunityRecommendation`, add: `serviceCategory ServiceCategory?`, `confidence ScoringConfidence?`.

In `model Prospect`, add: `businessCategory BusinessCategory?`, `lastContactedAt DateTime?`, and a back-relation `activities ProspectActivity[]`.

In `model WebsiteAudit`, add: `screenshotUrl String?`, `screenshotStatus String?` (holds `"captured" | "unavailable"`; kept as a plain string, not an enum, since the no-op provider's `reason` values are open-ended free text for now).

In `enum OutreachDraftStatus`, add `SENT` alongside `RUNNING | COMPLETED | FAILED`.

In `model OutreachDraft`, add: `sentAt DateTime?`, `sentSubject String?`, `sentBody String?`.

Add new model:

```prisma
model ProspectActivity {
  id         String               @id @default(cuid())
  userId     String
  prospectId String
  type       ProspectActivityType
  occurredAt DateTime             @default(now())
  metadata   Json?
  prospect   Prospect             @relation(fields: [prospectId], references: [id], onDelete: Cascade)

  @@index([userId, prospectId, occurredAt])
}
```

- [ ] **Step 2: Format and validate**

Run:

```bash
export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 22.12.0
cd packages/database && bunx prisma format && bunx prisma validate && bunx prisma generate
```

Expected: schema valid, client regenerated with all new types.

- [ ] **Step 3: Write the migration SQL by hand**

Create `packages/database/prisma/migrations/20260805060000_phase2_intelligence_pipeline/migration.sql`:

```sql
ALTER TYPE "OutreachDraftStatus" ADD VALUE 'SENT';

CREATE TYPE "OpportunityTier" AS ENUM ('EXCELLENT', 'HIGH', 'MEDIUM', 'LOW');
CREATE TYPE "ScoringConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');
CREATE TYPE "ScoringMethod" AS ENUM ('AI_LEGACY', 'DETERMINISTIC');
CREATE TYPE "ServiceCategory" AS ENUM ('WEBSITE_REDESIGN', 'PERFORMANCE_OPTIMIZATION', 'BOOKING_INTEGRATION', 'LEAD_CAPTURE_REPAIR', 'LEAD_RESPONSE_AUTOMATION');
CREATE TYPE "BusinessCategory" AS ENUM ('SALON_SPA', 'MEDICAL_DENTAL', 'HOME_SERVICES', 'AUTOMOTIVE', 'FITNESS', 'LEGAL_FINANCIAL', 'RESTAURANT_FOOD', 'RETAIL', 'PROFESSIONAL_SERVICES', 'OTHER');
CREATE TYPE "ProspectActivityType" AS ENUM ('OUTREACH_SENT');

ALTER TABLE "OpportunityAnalysis"
  ADD COLUMN "tier" "OpportunityTier",
  ADD COLUMN "scoringBreakdown" JSONB,
  ADD COLUMN "topReasons" JSONB,
  ADD COLUMN "disqualifiers" JSONB,
  ADD COLUMN "strongestIssue" TEXT,
  ADD COLUMN "suggestedOffer" TEXT,
  ADD COLUMN "confidence" "ScoringConfidence",
  ADD COLUMN "warnings" JSONB,
  ADD COLUMN "scoringMethod" "ScoringMethod" NOT NULL DEFAULT 'DETERMINISTIC';

UPDATE "OpportunityAnalysis" SET "scoringMethod" = 'AI_LEGACY' WHERE "status" = 'COMPLETED';

ALTER TABLE "OpportunityRecommendation"
  ADD COLUMN "serviceCategory" "ServiceCategory",
  ADD COLUMN "confidence" "ScoringConfidence";

ALTER TABLE "Prospect"
  ADD COLUMN "businessCategory" "BusinessCategory",
  ADD COLUMN "lastContactedAt" TIMESTAMP(3);

ALTER TABLE "WebsiteAudit"
  ADD COLUMN "screenshotUrl" TEXT,
  ADD COLUMN "screenshotStatus" TEXT;

ALTER TABLE "OutreachDraft"
  ADD COLUMN "sentAt" TIMESTAMP(3),
  ADD COLUMN "sentSubject" TEXT,
  ADD COLUMN "sentBody" TEXT;

CREATE TABLE "ProspectActivity" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "prospectId" TEXT NOT NULL,
  "type" "ProspectActivityType" NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  CONSTRAINT "ProspectActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProspectActivity_userId_prospectId_occurredAt_idx" ON "ProspectActivity"("userId", "prospectId", "occurredAt");

ALTER TABLE "ProspectActivity"
  ADD CONSTRAINT "ProspectActivity_prospectId_fkey"
  FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
```

`ALTER TYPE ... ADD VALUE` must be the first statement in the file, before any other statement in the same migration references that enum — PostgreSQL requires a new enum value to be committed before it can be used elsewhere in the same migration run.

- [ ] **Step 4: Commit**

```bash
git add packages/database/prisma
git commit -m "feat: add phase 2 opportunity, activity, and outreach schema"
```

---

### Task 4: Bounded AI interpretation layer and rewired opportunity action

**Files:**
- Modify: `apps/app/app/lib/opportunity/types.ts`
- Modify: `apps/app/app/lib/opportunity/schema.ts`
- Modify: `apps/app/app/lib/opportunity/prompt.ts`
- Modify: `apps/app/app/lib/opportunity/generate.ts`
- Modify: `apps/app/app/lib/opportunity/generate.test.ts`
- Modify: `apps/app/app/lib/opportunity/schema.test.ts`
- Modify: `apps/app/app/actions/opportunities.ts`
- Modify: `apps/app/app/actions/opportunities.test.ts`
- Create: `apps/app/app/lib/opportunity/allowed-numbers.ts`
- Create: `apps/app/app/lib/opportunity/allowed-numbers.test.ts`

**Interfaces:**
- Consumes: `computeOpportunityScore`/`ScoringResult` (Task 1), `selectRecommendations`/`RecommendationCandidate` (Task 2), all new Prisma fields (Task 3).
- Produces: `InterpretationInput`, `InterpretationOutput`, `generateInterpretation(input, options)` — replaces `generateOpportunity`. `buildAllowedNumbers(scoring: ScoringResult, recommendations: RecommendationCandidate[]): string[]`.

- [ ] **Step 0: Implement `buildAllowedNumbers`**

This exists so "which numbers may the AI's prose reference" is a precise, testable function rather than an ad hoc list assembled inline in the server action.

```ts
// allowed-numbers.ts
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
```

Write `allowed-numbers.test.ts` proving: the universal bounds (`"0"`, `"1"`, `"2"`, `"100"`) are always present; every category score, breakdown point value, top-reason point value, and recommendation weight from a representative `ScoringResult`/`RecommendationCandidate[]` pair appears in the output; no duplicates (it's built from a `Set`).

- [ ] **Step 1: Replace the AI output schema**

In `types.ts`, replace `OpportunityOutput` with:

```ts
export interface InterpretationOutput {
  confidence: "HIGH" | "MEDIUM" | "LOW";
  practicalImpact: string;
  strongestIssue: string;
  suggestedOffer: string;
  summary: string;
  warnings: string[];
}
```

In `schema.ts`, replace `opportunityOutputSchema`/`validateOpportunityOutput` with:

```ts
import { z } from "zod";
import type { InterpretationOutput } from "./types";

export const interpretationOutputSchema = z
  .object({
    summary: z.string().min(40).max(700),
    strongestIssue: z.string().min(10).max(200),
    practicalImpact: z.string().min(20).max(500),
    suggestedOffer: z.string().min(10).max(300),
    confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
    warnings: z.array(z.string().min(5).max(300)).max(5),
  })
  .strict();

const numberPattern = /-?\d+(\.\d+)?%?/g;

export const validateInterpretationOutput = (
  output: unknown,
  allowedNumbers: Set<string>
): InterpretationOutput => {
  const parsed = interpretationOutputSchema.parse(output);
  const text = `${parsed.summary} ${parsed.strongestIssue} ${parsed.practicalImpact} ${parsed.suggestedOffer}`;
  const found = text.match(numberPattern) ?? [];
  for (const value of found) {
    const normalized = value.replace(/%$/, "");
    if (!(allowedNumbers.has(value) || allowedNumbers.has(normalized))) {
      throw new Error(`Interpretation introduced an unlisted number: ${value}`);
    }
  }
  return parsed;
};
```

`allowedNumbers` is built by the caller from the deterministic output (the score, each category score, and every weight/point value already computed) — this is the mechanism that enforces "must never introduce a number not already present in its input."

- [ ] **Step 2: Replace the system prompt**

In `prompt.ts`:

```ts
export const INTERPRETATION_PROMPT_VERSION = "interpretation-v1";

export const INTERPRETATION_SYSTEM_PROMPT = `You are LeadForge's website opportunity interpreter. You receive an ALREADY-COMPUTED deterministic score, tier, category breakdown, top contributing findings, and already-selected service recommendations. Your only job is to explain them in plain language for a business owner deciding whether to reach out.

You must not invent, recompute, adjust, or restate any number that is not already present in the input you were given. Do not invent traffic, revenue, conversion rates, rankings, legal compliance, costs, customer intent, business size, or guaranteed results. Base every statement only on the supplied findings. Return concise, evidence-based prose, not hidden reasoning or chain-of-thought.`;
```

- [ ] **Step 3: Replace `generate.ts`**

```ts
import { generateText, Output } from "ai";
import { INTERPRETATION_SYSTEM_PROMPT } from "./prompt";
import { interpretationOutputSchema, validateInterpretationOutput } from "./schema";

const timeoutPattern = /timeout|abort/i;
const invalidOutputPattern = /unlisted number|zod|validation/i;

export type InterpretationGenerationFailure =
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "GATEWAY_ERROR"
  | "INVALID_OUTPUT";

export class InterpretationGenerationError extends Error {
  readonly code: InterpretationGenerationFailure;
  constructor(code: InterpretationGenerationFailure) {
    super(code);
    this.name = "InterpretationGenerationError";
    this.code = code;
  }
}

interface GenerateResult {
  output: unknown;
  usage: { inputTokens?: number; outputTokens?: number };
}
type Generator = (options: Record<string, unknown>) => Promise<GenerateResult>;

export const generateInterpretation = async (
  input: { allowedNumbers: string[]; [key: string]: unknown },
  options: { model: string; generate?: Generator; now?: () => number }
) => {
  const now = options.now ?? Date.now;
  const started = now();
  try {
    const result = await (options.generate ?? (generateText as unknown as Generator))({
      model: options.model,
      output: Output.object({ schema: interpretationOutputSchema }),
      system: INTERPRETATION_SYSTEM_PROMPT,
      prompt: JSON.stringify(input),
      temperature: 0,
      maxRetries: 0,
      timeout: 30_000,
      telemetry: { recordInputs: false, recordOutputs: false },
    });
    const output = validateInterpretationOutput(result.output, new Set(input.allowedNumbers));
    return {
      output,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      durationMs: now() - started,
    };
  } catch (error) {
    if (error instanceof InterpretationGenerationError) {
      throw error;
    }
    if (typeof error === "object" && error && "statusCode" in error && error.statusCode === 429) {
      throw new InterpretationGenerationError("RATE_LIMITED");
    }
    if (error instanceof Error && timeoutPattern.test(`${error.name} ${error.message}`)) {
      throw new InterpretationGenerationError("TIMEOUT");
    }
    if (error instanceof Error && invalidOutputPattern.test(`${error.name} ${error.message}`)) {
      throw new InterpretationGenerationError("INVALID_OUTPUT");
    }
    throw new InterpretationGenerationError("GATEWAY_ERROR");
  }
};
```

- [ ] **Step 4: Update `generate.test.ts` and `schema.test.ts`**

Rename/adapt existing tests to the new function/schema names and shapes; add one new test proving `validateInterpretationOutput` throws when the AI output contains a number absent from `allowedNumbers`, and passes when every number in the prose is present in `allowedNumbers` (build it from a realistic `ScoringResult`).

- [ ] **Step 5: Rewrite `apps/app/app/actions/opportunities.ts`**

Replace the single `generateOpportunity` call with: fetch the audit's checks and the prospect's `businessCategory`; call `computeOpportunityScore` and `selectRecommendations` synchronously (no try/catch needed around these — they are pure and cannot throw for valid input); if `scoringResult.disqualifiers.length > 0`, persist `status: "COMPLETED"`, the disqualifiers, `overallScore: 0`, and skip both interpretation and recommendations entirely (no AI call, no recommendation rows) — this is a valid, useful completed state, not a failure; otherwise call `buildAllowedNumbers(scoringResult, recommendations)` (Step 0), pass its result as `generateInterpretation`'s `allowedNumbers` input field, and persist the deterministic score/tier/breakdown/recommendations together with the AI's interpretation text in one transaction, setting `scoringMethod: "DETERMINISTIC"`. On an `InterpretationGenerationError`, still persist the deterministic score/tier/recommendations as `COMPLETED` (they don't depend on the AI call succeeding) but leave `strongestIssue`/`suggestedOffer`/`confidence`/`warnings`/`executiveSummary`/`overallRationale` null and log the interpretation failure separately — a scoring success should never be discarded because the prose-generation step failed.

- [ ] **Step 6: Update `opportunities.test.ts`**

Adapt existing tests to the new flow; add cases for: a disqualified audit persisting a completed, zero-score, no-recommendations analysis with no AI call attempted; a successful deterministic score persisting even when `generateInterpretation` throws; the full success path producing `scoringMethod: "DETERMINISTIC"` and populated interpretation fields.

- [ ] **Step 7: Run tests and verify GREEN**

Run: `bun run test apps/app/app/lib/opportunity apps/app/app/actions/opportunities.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/app/app/lib/opportunity apps/app/app/actions/opportunities.ts apps/app/app/actions/opportunities.test.ts
git commit -m "feat: replace AI opportunity scoring with deterministic engine"
```

---

### Task 5: Missing audit checks and screenshot-provider interface

**Files:**
- Modify: `packages/audit-engine/checks.ts`
- Modify: `packages/audit-engine/checks.test.ts`
- Modify: `packages/audit-engine/crawler.ts`
- Modify: `packages/audit-engine/crawler.test.ts`
- Create: `packages/audit-engine/screenshot.ts`
- Create: `packages/audit-engine/screenshot.test.ts`
- Modify: `packages/audit-engine/run-audit.ts`
- Modify: `packages/audit-engine/run-audit.test.ts`
- Modify: `packages/audit-engine/types.ts`

**Interfaces:**
- Produces: `ScreenshotProvider` interface, `noopScreenshotProvider`, four new `AuditFinding` keys (`phone_detection`, `email_detection`, `booking_detection`, `broken_images`, `copyright_year` — replacing `contact_signals`).

- [ ] **Step 1: Write failing tests for the new checks**

In `checks.test.ts`, add cases proving: `phone_detection`/`email_detection` fire independently (a page with only a phone number passes phone, fails email, and vice versa); `booking_detection` looks for booking/scheduling signals (e.g. "book now", "schedule appointment", common booking-widget hostnames like `calendly.com`/`acuityscheduling.com` in outbound links) and its summary text distinguishes "no booking system detected on the sampled pages" (never "this business has no booking system"); `broken_images` uses the crawl's sampled broken-image count (new `CrawlResult.brokenImages` field, populated the same way `brokenInternalLinks` already is) and is WARNING/FAIL by the same `threshold` helper used elsewhere; `copyright_year` extracts a 4-digit year near "©"/"copyright" in page text and is WARNING when more than 1 year stale, PASS otherwise, and absent-of-copyright-text is treated as PASS (no unsupported claim of "missing copyright," since that's not one of the five requested checks and copyright presence itself isn't the audited property — only staleness is); `contact_signals` no longer appears in `evaluateChecks`'s output.

- [ ] **Step 2: Run tests and verify RED**

Run: `bun run test packages/audit-engine/checks.test.ts`
Expected: FAIL — new check keys not yet produced.

- [ ] **Step 3: Implement the new checks in `checks.ts`**

Remove `CONTACT_SIGNALS` and its check. Add:

```ts
const PHONE_SIGNALS = /(tel:|\bphone\b|\bcall us\b)/;
const EMAIL_SIGNALS = /(mailto:|\bemail\b)/;
const BOOKING_SIGNALS = /(book now|schedule an? appointment|calendly\.com|acuityscheduling\.com|square\.site\/appointments|book\.squareup\.com)/;
const COPYRIGHT_YEAR = /(?:©|copyright)\D{0,10}(\d{4})/i;
```

Add findings:

```ts
finding("TRUST", "phone_detection", "Phone detection", PHONE_SIGNALS.test(combined) ? "PASS" : "FAIL", { found: PHONE_SIGNALS.test(combined) }),
finding("TRUST", "email_detection", "Email detection", EMAIL_SIGNALS.test(combined) ? "PASS" : "FAIL", { found: EMAIL_SIGNALS.test(combined) }),
```

Add a new `BOOKING` category finding (extend `AuditCategory`/`AuditCheckCategory` — see Step 4):

```ts
(() => {
  const found = BOOKING_SIGNALS.test(combined);
  return finding("BOOKING", "booking_detection", "Booking detection", found ? "PASS" : "FAIL", { found });
})(),
```

The `finding()` helper's generated `summary` already reads `"${label} ${status === "PASS" ? "meets" : "needs attention for"} the audit check."` — for `booking_detection` specifically, override the summary explicitly (don't rely on the generic phrasing) to read `"No booking system detected on the sampled pages."` on FAIL, so the language is unambiguously about detection scope, not the business's actual capabilities.

Add broken-images and copyright findings using the crawl's new fields (Step 5/6):

```ts
finding("TECHNICAL", "broken_images", "Broken images", threshold(crawl.brokenImages, 0, 1), { brokenImages: crawl.brokenImages }),
finding("TRUST", "copyright_year", "Copyright freshness", copyrightStatus, { year: copyrightYear, currentYear }),
```

where `copyrightYear` is extracted from `home.text` via `COPYRIGHT_YEAR`, `currentYear = new Date().getUTCFullYear()`, and `copyrightStatus` is `"PASS"` when no year is found or the year is within 1 of `currentYear`, `"WARNING"` otherwise (never `"FAIL"` — this is explicitly a low-severity signal per the design).

- [ ] **Step 4: Extend the category type**

In `types.ts`, add `"BOOKING"` to `AuditCategory`. In `packages/database/prisma/schema.prisma`, add `BOOKING` to the `AuditCheckCategory` enum (Task 3 already ran and committed by the time this task starts, so this is a schema change scoped entirely to this task). Create a second migration, `packages/database/prisma/migrations/20260805070000_phase2_audit_categories/migration.sql`, containing only:

```sql
ALTER TYPE "AuditCheckCategory" ADD VALUE 'BOOKING';
```

Run `bunx prisma format && bunx prisma validate && bunx prisma generate` from `packages/database` after this change, same as Task 3's Step 2.

- [ ] **Step 5: Add broken-image sampling to the crawler**

In `crawler.ts`, alongside the existing broken-internal-link sampling loop (same file, same `validatePublicTarget` + fetch pattern, same 20-URL sample cap), sample `<img>` `src` URLs collected during `parseFacts` (add an `images: string[]` array of resolved image URLs to `PageFacts`, capped at 20 total across sampled pages, reusing the existing dedup/slice pattern) and count how many return a non-2xx response or fail to fetch, into a new `brokenImages: number` field on `CrawlResult`. Reuse `validatePublicTarget` for each sampled image URL exactly as the broken-link sampler already does — never fetch an image URL without the same SSRF check applied to page URLs.

- [ ] **Step 6: Write and run crawler tests for broken-image sampling and screenshot wiring**

Add a `crawler.test.ts` case with a mocked page containing image tags where some fetch calls are mocked to fail, asserting `brokenImages` counts correctly and respects the sampling cap.

Run: `bun run test packages/audit-engine/crawler.test.ts packages/audit-engine/checks.test.ts`
Expected: PASS once Steps 3 and 5 are both in place.

- [ ] **Step 7: Implement the `ScreenshotProvider` interface**

```ts
// screenshot.ts
export type ScreenshotResult =
  | { status: "captured"; url: string }
  | { status: "unavailable"; reason: string };

export interface ScreenshotProvider {
  capture: (url: string) => Promise<ScreenshotResult>;
}

export const noopScreenshotProvider: ScreenshotProvider = {
  capture: () => Promise.resolve({ status: "unavailable", reason: "not_configured" }),
};
```

Write `screenshot.test.ts` proving `noopScreenshotProvider.capture(...)` always resolves to `{ status: "unavailable", reason: "not_configured" }` and never rejects.

- [ ] **Step 8: Wire the provider into `run-audit.ts`**

Add an optional `screenshotProvider` dependency (default `noopScreenshotProvider`) to `AuditDependencies`/`runWebsiteAudit`'s options. After the crawl completes (success or not — screenshot capture must run independently and never block or fail the audit), call `dependencies.screenshotProvider.capture(crawl.finalUrl)` inside a `try/catch` that falls back to `{ status: "unavailable", reason: "capture_failed" }` on any thrown error, and include the result as `screenshot: ScreenshotResult` in `runWebsiteAudit`'s return value.

Add a `run-audit.test.ts` case proving a `screenshotProvider.capture` that throws still allows `runWebsiteAudit` to resolve successfully with `screenshot: { status: "unavailable", reason: "capture_failed" }`.

- [ ] **Step 9: Wire the audit action to persist `screenshotUrl`/`screenshotStatus`**

In `apps/app/app/actions/audits.ts`, persist `screenshotUrl: result.screenshot.status === "captured" ? result.screenshot.url : null` and `screenshotStatus: result.screenshot.status` onto the `WebsiteAudit` row alongside the existing completion fields.

- [ ] **Step 10: Run full package tests and verify GREEN**

Run: `bun run test packages/audit-engine apps/app/app/actions/audits.test.ts`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/audit-engine packages/database/prisma apps/app/app/actions/audits.ts
git commit -m "feat: add booking, image, copyright, and contact-split audit checks"
```

---

### Task 6: Business category field

**Files:**
- Modify: `packages/validation/prospect.ts` (defines `prospectSchema`, re-exported from `packages/validation/index.ts`)
- Modify: `apps/app/app/actions/prospects.ts`
- Modify: `apps/app/app/actions/prospects.test.ts`
- Modify: `apps/app/app/(authenticated)/prospects/new/page.tsx` (or its form component)
- Modify: `apps/app/app/(authenticated)/prospects/[id]/page.tsx`

**Interfaces:**
- Consumes: `BusinessCategory` Prisma enum (Task 3).
- Produces: no new exported names — `createProspect`/`updateProspect` accept an optional `businessCategory` field.

- [ ] **Step 1: Read the current prospect schema and form conventions**

Before writing code, read `packages/validation/prospect.ts`'s existing `prospectSchema` and the create/edit form components, to match exact existing field patterns (optional-string handling, select-input conventions already used elsewhere in this app, e.g. the pipeline stage select in `move-stage-form.tsx`).

- [ ] **Step 2: Write failing tests**

Add cases to `prospects.test.ts` proving `createProspect`/`updateProspect` accept a valid `businessCategory` value, normalize an empty selection to `null`, and reject an invalid enum value with a field error — following the exact assertion style already used for `websiteUrl`/`contactEmail` normalization in that file.

- [ ] **Step 3: Run tests and verify RED**

Run: `bun run test apps/app/app/actions/prospects.test.ts`

- [ ] **Step 4: Add `businessCategory` to validation, actions, and both forms**

Add an optional enum field to the Zod schema (`z.enum([...]).nullable().optional()` pattern, mirroring how other optional fields are already declared in that file), thread it through `parseForm` in `prospects.ts`, and add a `<select>` with the 10 category options (labeled in plain English, e.g. "Salon / Spa") to both the new-prospect form and the prospect-detail edit form, following the exact styling/structure of the existing pipeline-stage `<select>` in `move-stage-form.tsx`.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `bun run test apps/app/app/actions/prospects.test.ts`

- [ ] **Step 6: Commit**

```bash
git add packages/validation apps/app/app/actions/prospects.ts apps/app/app/actions/prospects.test.ts "apps/app/app/(authenticated)/prospects"
git commit -m "feat: add manual business category to prospects"
```

---

### Task 7: Outreach sent flow and follow-up-task suggestion

**Files:**
- Modify: `apps/app/app/actions/outreach.ts`
- Modify: `apps/app/app/actions/outreach.test.ts`
- Modify: `apps/app/app/(authenticated)/outreach/[id]/page.tsx`
- Create: `apps/app/app/(authenticated)/outreach/[id]/mark-sent-form.tsx`
- Create: `apps/app/app/(authenticated)/outreach/[id]/mark-sent-form.test.tsx`
- Create: `apps/app/app/(authenticated)/outreach/[id]/follow-up-suggestion.tsx`
- Create: `apps/app/app/(authenticated)/outreach/[id]/follow-up-suggestion.test.tsx`

**Interfaces:**
- Consumes: `ProspectActivity`, `Prospect.lastContactedAt`, `OutreachDraftStatus.SENT` (Task 3); `createTask` from `apps/app/app/actions/tasks.ts` (existing, M5).
- Produces: `markOutreachSent(draftId: string): Promise<{status: "success"|"error"; message: string}>`, no other new exported names — the follow-up suggestion reuses M5's existing task-creation action rather than adding a new one.

- [ ] **Step 1: Write failing tests**

Add to `outreach.test.ts`: `markOutreachSent` sets `status: "SENT"`, `sentAt`, and snapshots the current working `subject`/`body` into `sentSubject`/`sentBody`; sets `Prospect.lastContactedAt`; creates a `ProspectActivity` row with `type: "OUTREACH_SENT"`; advances `pipelineStage` from `NEW` to `CONTACTED` but leaves `INTERESTED`/`PROPOSAL`/`WON`/`LOST` untouched (parameterize this exactly like the existing `it.each` patterns in `pipeline.test.ts`); is owner-scoped and rejects a forged/cross-owner draft ID with the same safe error style as other actions in this file; is atomic (one `$transaction`, matching the existing transaction patterns already used in `pipeline.ts`/`prospects.ts`).

- [ ] **Step 2: Run tests and verify RED**

Run: `bun run test apps/app/app/actions/outreach.test.ts`

- [ ] **Step 3: Implement `markOutreachSent`**

Inside one `database.$transaction`: re-fetch the draft and its prospect by ID scoped to `userId`; if not found, return the same safe "not found" error style used elsewhere in this file; update the draft to `status: "SENT"`, `sentAt: now`, `sentSubject`/`sentBody` copied from the draft's current `subject`/`body` (falling back to `generatedSubject`/`generatedBody` if the working copy was never edited — match whatever fallback convention `outreach.ts` already uses for "current" subject/body elsewhere in the file); update `Prospect.lastContactedAt = now`, and update `pipelineStage` to `"CONTACTED"` only via a conditional update (`updateMany` with `pipelineStage: "NEW"` in the `where` clause, matching the optimistic-update pattern already used in `pipeline.ts`'s `executeMoveTransaction`) so it never touches a prospect already past `NEW`; create the `ProspectActivity` row with `metadata: { outreachDraftId: draftId }`.

Note: this worktree branched from `main` before the separate M6 milestone (which adds a `PipelineStageChange` stage-history log) was merged, so that model does not exist here — do not reference or depend on it. If M6 has been merged into `main` by the time this task runs, check `packages/database/prisma/schema.prisma` for a `PipelineStageChange` model; if present, write the same kind of history row (`fromStage: "NEW"`, `toStage: "CONTACTED"`) here for consistency. If absent, skip this entirely — a plain `pipelineStage` update is sufficient and correct on its own.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `bun run test apps/app/app/actions/outreach.test.ts`

- [ ] **Step 5: Build the "mark sent" and follow-up-suggestion UI**

`mark-sent-form.tsx`: a single-button form calling `markOutreachSent`, disabled/hidden once `status` is already `"SENT"`, showing the persisted `sentAt`/`sentSubject`/`sentBody` as a read-only historical record once sent (the editable working-copy fields remain separately editable/resettable exactly as before — sending does not lock editing of future drafts).

`follow-up-suggestion.tsx`: rendered only immediately after a successful "mark sent," offering a single "Create follow-up task" button. Clicking it submits to the existing M5 `createTask` action with a pre-filled title (e.g. `"Follow up: <businessName>"`) and a due date computed as 5 business days from now in `America/New_York` (reuse M5's existing business-day/timezone helpers in `apps/app/app/lib/tasks/time.ts` if a suitable one exists; if not, add a small `addBusinessDays` pure helper there, tested the same way the file's existing date helpers are tested). Declining (navigating away, not clicking) creates nothing — there is no auto-create path.

- [ ] **Step 6: Write UI-state tests**

Following the same "pure helpers or component tests, not browser/library internals" convention from M5's task UI tests: test `addBusinessDays` directly if added, and test that `follow-up-suggestion.tsx` never calls the task-creation action on render, only on explicit click.

- [ ] **Step 7: Run formatter and full verification**

```bash
bun run fix
bun --filter app typecheck
bun run test apps/app/app/actions/outreach.test.ts "apps/app/app/(authenticated)/outreach"
```

- [ ] **Step 8: Commit**

```bash
git add apps/app/app/actions/outreach.ts apps/app/app/actions/outreach.test.ts "apps/app/app/(authenticated)/outreach" apps/app/app/lib/tasks
git commit -m "feat: add outreach sent flow and follow-up suggestion"
```

---

### Task 8: Documentation, migration deployment, and acceptance verification

**Files:**
- Create: `docs/architecture/0008-phase2-intelligence-pipeline.md`
- Modify: `README.md`

**Interfaces:**
- Documents: why scoring/recommendations moved from AI to deterministic rules, the exact point/weight tables, the screenshot-provider deferral, the outreach-sent/activity model, and the full non-goals list.

- [ ] **Step 1: Add ADR and README documentation**

Document: why AI scoring was replaced (reproducibility and traceability — the same audit must always produce the same score); the category-cap mechanism and why it exists; the `ScreenshotProvider` interface and the explicit decision not to add paid browser infrastructure yet; the `businessCategory` field's manual, non-automated nature; the outreach-sent/`ProspectActivity`/stage-advance-only-from-NEW behavior; and that follow-up tasks remain exclusively owner-initiated. Add any new routes/fields to README's route and setup documentation as applicable (this phase adds no new top-level routes, so this should be limited to noting the new `businessCategory` prospect field and the mark-sent flow in the relevant existing route descriptions).

- [ ] **Step 2: Apply migrations to the configured database**

Run: `bun run migrate:deploy`.
Expected: both new migrations from Tasks 3 and 5 apply successfully; existing `OpportunityAnalysis` rows read back with `scoringMethod = 'AI_LEGACY'`.

- [ ] **Step 3: Run fresh full verification**

```bash
bun run check
bun run test
bun run build
cd packages/database && bunx prisma validate
cd ../.. && git diff --check
```

Expected: all exit 0.

- [ ] **Step 4: Run the real-site acceptance workflow**

Using an allowlisted owner session against a real public business website:
1. Create a prospect with a `businessCategory` set.
2. Run a website audit; confirm the four new checks appear with evidence, and the screenshot result shows `"unavailable"` without failing the audit.
3. Generate an opportunity analysis; confirm the score/tier/breakdown/recommendations are traceable to specific check keys, and re-running analysis on the same audit (if the flow allows) produces an identical deterministic score.
4. Generate outreach from the top recommendation, edit it, and mark it sent; confirm `lastContactedAt`, the `ProspectActivity` row, and the `NEW → CONTACTED` stage advance (or its absence, if the prospect was already past `NEW`).
5. Accept the follow-up-task suggestion once and decline it once (on two different prospects or two different sends); confirm no task is created when declined.
6. Check the browser console for application errors.

Report findings, false positives, the full score breakdown observed, recommendations produced, generated outreach text, and any remaining reliability issues.

- [ ] **Step 5: Commit docs and inspect branch**

```bash
git add README.md docs/architecture/0008-phase2-intelligence-pipeline.md
git commit -m "docs: record phase 2 intelligence pipeline decisions"
git status --short
git log --oneline main..HEAD
git diff --stat main...HEAD
```

Expected: clean tree; diff includes only Phase 2 scoring/recommendation engines, schema, audit checks, outreach/activity flow, and documentation.

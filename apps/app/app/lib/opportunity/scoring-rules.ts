export type CheckStatus = "PASS" | "WARNING" | "FAIL";

export interface PointRule {
  fail?: number;
  warning?: number;
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
export const getCategoryCap = (
  category: string,
  isAppointmentDriven: boolean
): number =>
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
  matches: (
    checksByKey: Map<string, { status: CheckStatus; evidence: unknown }>
  ) => boolean;
  points: number;
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

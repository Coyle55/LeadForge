import type { CheckStatus } from "./scoring-rules";

export type ServiceCategory =
  | "WEBSITE_REDESIGN"
  | "PERFORMANCE_OPTIMIZATION"
  | "BOOKING_INTEGRATION"
  | "LEAD_CAPTURE_REPAIR"
  | "LEAD_RESPONSE_AUTOMATION";

export const RECOMMENDATION_THRESHOLD = 3;

export const SERVICE_EFFORT: Record<
  ServiceCategory,
  "HIGH" | "MEDIUM" | "LOW"
> = {
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
  {
    checkKey: "calls_to_action",
    service: "WEBSITE_REDESIGN",
    statuses: { WARNING: 2, FAIL: 3 },
  },
  {
    checkKey: "viewport_meta",
    service: "WEBSITE_REDESIGN",
    statuses: { FAIL: 3 },
  },
  {
    checkKey: "broken_internal_links",
    service: "WEBSITE_REDESIGN",
    statuses: { FAIL: 2 },
  },
  {
    checkKey: "broken_images",
    service: "WEBSITE_REDESIGN",
    statuses: { FAIL: 1 },
  },
  {
    checkKey: "mixed_content",
    service: "WEBSITE_REDESIGN",
    statuses: { FAIL: 1 },
  },
  {
    checkKey: "server_response_time",
    service: "PERFORMANCE_OPTIMIZATION",
    statuses: { WARNING: 2, FAIL: 3 },
  },
  {
    checkKey: "render_blocking_resources",
    service: "PERFORMANCE_OPTIMIZATION",
    statuses: { FAIL: 1 },
  },
  {
    checkKey: "html_size",
    service: "PERFORMANCE_OPTIMIZATION",
    statuses: { FAIL: 1 },
  },
  {
    checkKey: "script_count",
    service: "PERFORMANCE_OPTIMIZATION",
    statuses: { FAIL: 1 },
  },
  {
    checkKey: "booking_detection",
    service: "BOOKING_INTEGRATION",
    statuses: { FAIL: 3 },
  },
  {
    checkKey: "contact_path",
    service: "LEAD_CAPTURE_REPAIR",
    statuses: { FAIL: 2 },
  },
  {
    checkKey: "phone_detection",
    service: "LEAD_CAPTURE_REPAIR",
    statuses: { FAIL: 2 },
  },
  {
    checkKey: "email_detection",
    service: "LEAD_CAPTURE_REPAIR",
    statuses: { FAIL: 1 },
  },
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

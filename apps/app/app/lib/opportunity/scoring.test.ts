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

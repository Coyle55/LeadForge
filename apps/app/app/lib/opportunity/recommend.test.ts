import { describe, expect, it } from "vitest";
import { selectRecommendations } from "./recommend";

const check = (
  key: string,
  category: string,
  status: "PASS" | "WARNING" | "FAIL"
) => ({
  key,
  category,
  status,
  evidence: {},
});

describe("selectRecommendations", () => {
  it("returns nothing when every check passes", () => {
    expect(
      selectRecommendations(
        [
          check("calls_to_action", "TRUST", "PASS"),
          check("booking_detection", "BOOKING", "PASS"),
        ],
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
    expect(result.map((r) => r.serviceCategory)).not.toContain(
      "LEAD_CAPTURE_REPAIR"
    );
  });

  it("keeps the single highest-weighted service when nothing clears the threshold", () => {
    const result = selectRecommendations(
      [check("email_detection", "TRUST", "FAIL")],
      null
    );
    expect(result).toHaveLength(1);
    expect(result[0].serviceCategory).toBe("LEAD_CAPTURE_REPAIR");
    expect(result[0].weight).toBe(1);
  });

  it("doubles booking weight for appointment-driven categories", () => {
    const base = selectRecommendations(
      [check("booking_detection", "BOOKING", "FAIL")],
      null
    );
    const salon = selectRecommendations(
      [check("booking_detection", "BOOKING", "FAIL")],
      "SALON_SPA"
    );
    expect(base[0].weight).toBe(3);
    expect(salon[0].weight).toBe(6);
  });

  it("derives confidence from total weight", () => {
    const high = selectRecommendations(
      [
        check("calls_to_action", "TRUST", "FAIL"),
        check("viewport_meta", "TECHNICAL", "FAIL"),
        check("broken_internal_links", "TECHNICAL", "FAIL"),
      ],
      null
    );
    expect(high[0].weight).toBeGreaterThanOrEqual(6);
    expect(high[0].confidence).toBe("HIGH");
  });

  it("combines booking and contact gaps into a lead-response-automation signal", () => {
    const result = selectRecommendations(
      [
        check("booking_detection", "BOOKING", "FAIL"),
        check("phone_detection", "TRUST", "FAIL"),
      ],
      null
    );
    expect(
      result.some((r) => r.serviceCategory === "LEAD_RESPONSE_AUTOMATION")
    ).toBe(true);
  });
});

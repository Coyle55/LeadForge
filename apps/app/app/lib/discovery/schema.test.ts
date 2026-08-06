import { describe, expect, it } from "vitest";
import { validateCandidate } from "./schema";

describe("validateCandidate", () => {
  it("accepts a candidate with only businessName and sourceUrls", () => {
    const result = validateCandidate({
      businessName: "Ace Plumbing",
      sourceUrls: ["https://example.com/listing"],
      confidence: "MEDIUM",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a candidate missing businessName", () => {
    const result = validateCandidate({
      sourceUrls: ["https://example.com"],
      confidence: "LOW",
    });
    expect(result).toEqual({
      ok: false,
      reason: expect.stringContaining("businessName"),
    });
  });

  it("rejects a candidate with empty sourceUrls", () => {
    const result = validateCandidate({
      businessName: "Ace Plumbing",
      sourceUrls: [],
      confidence: "LOW",
    });
    expect(result).toEqual({
      ok: false,
      reason: expect.stringContaining("sourceUrls"),
    });
  });

  it("accepts a candidate missing websiteUrl (import-ineligible, not rejected)", () => {
    const result = validateCandidate({
      businessName: "Ace Plumbing",
      sourceUrls: ["https://example.com"],
      confidence: "LOW",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.websiteUrl).toBeUndefined();
    }
  });

  it("accepts a candidate missing confidence and defaults it to LOW", () => {
    const result = validateCandidate({
      businessName: "Ace Plumbing",
      sourceUrls: ["https://example.com"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.confidence).toBe("LOW");
    }
  });

  it("treats an empty-string websiteUrl as absent rather than rejecting", () => {
    const result = validateCandidate({
      businessName: "Ace Plumbing",
      websiteUrl: "",
      sourceUrls: ["https://example.com"],
      confidence: "MEDIUM",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.websiteUrl).toBeUndefined();
    }
  });
});

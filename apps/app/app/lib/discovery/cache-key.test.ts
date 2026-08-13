import { describe, expect, it } from "vitest";
import { buildDiscoveryCacheKey } from "./cache-key";

const baseParams = {
  businessType: "Plumbers",
  location: "Cincinnati, OH",
  model: "anthropic/claude-haiku-4.5",
  provider: "PERPLEXITY_GATEWAY_SEARCH",
  resultLimit: 10,
};

describe("buildDiscoveryCacheKey", () => {
  it("produces identical keys for identical inputs", () => {
    expect(buildDiscoveryCacheKey(baseParams)).toBe(
      buildDiscoveryCacheKey({ ...baseParams })
    );
  });

  it("changes the key when businessType changes", () => {
    expect(buildDiscoveryCacheKey(baseParams)).not.toBe(
      buildDiscoveryCacheKey({ ...baseParams, businessType: "Electricians" })
    );
  });

  it("changes the key when location changes", () => {
    expect(buildDiscoveryCacheKey(baseParams)).not.toBe(
      buildDiscoveryCacheKey({ ...baseParams, location: "Columbus, OH" })
    );
  });

  it("changes the key when resultLimit changes", () => {
    expect(buildDiscoveryCacheKey(baseParams)).not.toBe(
      buildDiscoveryCacheKey({ ...baseParams, resultLimit: 5 })
    );
  });

  it("changes the key when model changes", () => {
    expect(buildDiscoveryCacheKey(baseParams)).not.toBe(
      buildDiscoveryCacheKey({ ...baseParams, model: "openai/gpt-5" })
    );
  });

  it("changes the key when provider changes", () => {
    expect(buildDiscoveryCacheKey(baseParams)).not.toBe(
      buildDiscoveryCacheKey({ ...baseParams, provider: "OTHER_PROVIDER" })
    );
  });

  it("does not change the key for case/whitespace variance in businessType or location", () => {
    expect(buildDiscoveryCacheKey(baseParams)).toBe(
      buildDiscoveryCacheKey({
        ...baseParams,
        businessType: "  PLUMBERS  ",
        location: "  cincinnati,   oh  ",
      })
    );
  });
});

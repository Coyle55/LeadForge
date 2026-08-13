import { describe, expect, it } from "vitest";
import {
  hashIdentity,
  normalizeAddress,
  normalizeDomain,
  normalizeName,
  normalizePhone,
} from "./normalize";

// Regex hoisted for performance
const HEX_REGEX = /^[0-9a-f]+$/;

describe("normalizeDomain", () => {
  it("strips protocol, www, trailing slash, and path", () => {
    expect(normalizeDomain("https://www.Example.com/plumbing/")).toBe(
      "example.com"
    );
    expect(normalizeDomain("http://example.com")).toBe("example.com");
    expect(normalizeDomain("example.com/about")).toBe("example.com");
  });

  it("returns null for an unparseable value", () => {
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain("not a url")).toBeNull();
  });
});

describe("normalizePhone", () => {
  it("strips formatting to digits only", () => {
    expect(normalizePhone("(513) 555-0142")).toBe("5135550142");
    expect(normalizePhone("+1 513.555.0142")).toBe("15135550142");
  });

  it("returns null for a value with no digits", () => {
    expect(normalizePhone("call us")).toBeNull();
  });
});

describe("normalizeName", () => {
  it("lowercases, collapses whitespace, and strips punctuation", () => {
    expect(normalizeName("  Ace's  Plumbing, Inc.  ")).toBe(
      "aces plumbing inc"
    );
  });

  it("returns empty string for empty input", () => {
    expect(normalizeName("")).toBe("");
  });

  it("handles unicode and non-ASCII characters", () => {
    expect(normalizeName("Café José's Restaurant")).toBe(
      "café josés restaurant"
    );
    expect(normalizeName("Müller GmbH")).toBe("müller gmbh");
  });
});

describe("normalizeAddress", () => {
  it("lowercases, collapses whitespace, and strips punctuation", () => {
    expect(normalizeAddress("123 Main St., Suite #4, Cincinnati, OH")).toBe(
      "123 main st suite 4 cincinnati oh"
    );
  });

  it("returns empty string for empty input", () => {
    expect(normalizeAddress("")).toBe("");
  });
});

describe("hashIdentity", () => {
  it("produces deterministic output for the same input", () => {
    const input = "test-value";
    const hash1 = hashIdentity(input);
    const hash2 = hashIdentity(input);
    expect(hash1).toBe(hash2);
  });

  it("produces different outputs for different inputs", () => {
    const hash1 = hashIdentity("value1");
    const hash2 = hashIdentity("value2");
    expect(hash1).not.toBe(hash2);
  });

  it("returns a valid hex string", () => {
    const hash = hashIdentity("test");
    expect(HEX_REGEX.test(hash)).toBe(true);
  });
});

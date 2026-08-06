import { describe, expect, it } from "vitest";
import { normalizeAddress, normalizeDomain, normalizeName, normalizePhone } from "./normalize";

describe("normalizeDomain", () => {
  it("strips protocol, www, trailing slash, and path", () => {
    expect(normalizeDomain("https://www.Example.com/plumbing/")).toBe("example.com");
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
    expect(normalizeName("  Ace's  Plumbing, Inc.  ")).toBe("aces plumbing inc");
  });
});

describe("normalizeAddress", () => {
  it("lowercases, collapses whitespace, and strips punctuation", () => {
    expect(normalizeAddress("123 Main St., Suite #4, Cincinnati, OH")).toBe(
      "123 main st suite 4 cincinnati oh"
    );
  });
});

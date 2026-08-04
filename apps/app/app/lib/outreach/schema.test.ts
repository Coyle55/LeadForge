import { describe, expect, it } from "vitest";
import { validateOutreachOutput } from "./schema";

const valid = {
  subject: "A quick thought about Acme",
  body: "Hi Jordan,\n\nI noticed a clear contact path may be missing on Acme's website. We help service businesses make those next steps clearer. Would a brief conversation next week be useful?",
};

describe("validateOutreachOutput", () => {
  it("accepts a plain-text subject and newline-separated body", () => {
    expect(validateOutreachOutput(valid)).toEqual(valid);
  });

  it("rejects fields outside the generated email contract", () => {
    expect(() =>
      validateOutreachOutput({
        ...valid,
        recipientEmail: "jordan@acme.example",
      })
    ).toThrow();
  });

  it("rejects blank and overlong generated text", () => {
    expect(() =>
      validateOutreachOutput({ ...valid, subject: "   " })
    ).toThrow();
    expect(() =>
      validateOutreachOutput({ ...valid, subject: "x".repeat(121) })
    ).toThrow();
    expect(() =>
      validateOutreachOutput({ ...valid, body: "x".repeat(2001) })
    ).toThrow();
  });

  it("rejects unsupported control characters", () => {
    expect(() =>
      validateOutreachOutput({ ...valid, body: `${valid.body}\u0007` })
    ).toThrow();
    expect(() =>
      validateOutreachOutput({ ...valid, body: `${valid.body}\u009B` })
    ).toThrow();
  });

  it("accepts CRLF-separated plain text", () => {
    const body = valid.body.replaceAll("\n", "\r\n");

    expect(validateOutreachOutput({ ...valid, body })).toEqual({
      ...valid,
      body,
    });
  });

  it("rejects markdown and HTML decoration", () => {
    expect(() =>
      validateOutreachOutput({
        ...valid,
        subject: "# A quick thought about Acme",
      })
    ).toThrow();
    expect(() =>
      validateOutreachOutput({
        ...valid,
        body: `${valid.body}\n\n[Schedule a call](https://acme.example)`,
      })
    ).toThrow();
    expect(() =>
      validateOutreachOutput({ ...valid, body: `<p>${valid.body}</p>` })
    ).toThrow();
  });

  it("rejects markdown links with empty labels or destinations", () => {
    expect(() =>
      validateOutreachOutput({
        ...valid,
        body: `${valid.body}\n\n[](https://example.com)`,
      })
    ).toThrow();
    expect(() =>
      validateOutreachOutput({
        ...valid,
        body: `${valid.body}\n\n[Schedule]()`,
      })
    ).toThrow();
  });

  it("rejects fenced code, inline code, emphasis, and strikethrough decoration", () => {
    for (const decoration of [
      "```text\nA decorated block\n```",
      "Use `this phrase` in the reply.",
      "This is **important** for the contact path.",
      "This is _important_ for the contact path.",
      "This is ~~urgent~~ for the contact path.",
    ]) {
      expect(() =>
        validateOutreachOutput({
          ...valid,
          body: `${valid.body}\n\n${decoration}`,
        })
      ).toThrow();
    }
  });

  it("accepts ordinary email punctuation, URLs, addresses, and underscores", () => {
    const body =
      "Hi Jordan,\n\nRe: Acme's contact-flow follow-up — I noticed visitors may need an extra step. You can reach me at casey_smith@northstar.example or https://northstar.example/about. Is Tuesday (Aug. 11) useful?";

    expect(validateOutreachOutput({ ...valid, body })).toEqual({
      ...valid,
      body,
    });
  });
});

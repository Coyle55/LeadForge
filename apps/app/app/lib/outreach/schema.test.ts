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
});

import { describe, expect, it } from "vitest";
import { outreachDraftEditSchema, outreachProfileSchema } from "./index";

const validProfile = {
  senderName: " Casey ",
  companyName: "LeadForge",
  serviceOffered: "Website conversion improvements",
  valueProposition: "Turn high-intent visits into more qualified inquiries.",
  defaultCta: "Worth a quick reply if this is a priority?",
};

const validDraft = {
  subject: " Quick thought about Acme's contact flow ",
  body: " Hi Jordan,\n\nI noticed your contact flow could make it harder for visitors to reach your team. ",
};

describe("outreach validation", () => {
  it("accepts and trims a complete sender profile", () => {
    const result = outreachProfileSchema.safeParse(validProfile);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.senderName).toBe("Casey");
    }
  });

  it("accepts and trims an editable plain-text draft", () => {
    const result = outreachDraftEditSchema.safeParse(validDraft);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        subject: "Quick thought about Acme's contact flow",
        body: "Hi Jordan,\n\nI noticed your contact flow could make it harder for visitors to reach your team.",
      });
    }
  });

  it("rejects incomplete or recipient-dependent values", () => {
    const { senderName: _senderName, ...missingSenderName } = validProfile;

    expect(outreachProfileSchema.safeParse(missingSenderName).success).toBe(
      false
    );
    expect(
      outreachProfileSchema.safeParse({
        ...validProfile,
        senderName: "",
      }).success
    ).toBe(false);
    expect(
      outreachDraftEditSchema.safeParse({
        ...validDraft,
        recipientEmail: "jordan@acme.example",
      }).success
    ).toBe(false);
  });

  it("rejects subject and body content above their bounds", () => {
    expect(
      outreachDraftEditSchema.safeParse({
        ...validDraft,
        subject: "s".repeat(121),
      }).success
    ).toBe(false);
    expect(
      outreachDraftEditSchema.safeParse({
        ...validDraft,
        body: "b".repeat(2001),
      }).success
    ).toBe(false);
  });

  it("permits tabs and newlines but rejects other control characters", () => {
    expect(
      outreachDraftEditSchema.safeParse({
        subject: "Quick\tthought",
        body: "Hi Jordan,\n\nThis message keeps its line breaks and tab\tspacing intact.",
      }).success
    ).toBe(true);
    expect(
      outreachDraftEditSchema.safeParse({
        ...validDraft,
        body: "Hi Jordan,\u0001this draft includes an unsupported control character.",
      }).success
    ).toBe(false);
  });
});

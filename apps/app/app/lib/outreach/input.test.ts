import { describe, expect, it } from "vitest";
import { buildOutreachInput } from "./input";

describe("buildOutreachInput", () => {
  it("keeps only selected, bounded audit evidence and sender context", () => {
    const result = buildOutreachInput({
      prospect: {
        id: "prospect-private-id",
        contactName: " \t Jordan   Smith ",
        contactEmail: "jordan@acme.example",
        name: "Acme",
        notes: "Do not send this note to the model.",
        requestedUrl:
          "https://user:secret@acme.example/services?token=private#details",
      },
      recommendation: {
        id: "recommendation-private-id",
        title: "Improve contact paths",
        rationale: "Visitors have no clear route to start a conversation.",
        action: "Add a visible contact action to service pages.",
        auditCheckKeys: ["contact_path"],
        internalNotes: "Do not share this recommendation note.",
      },
      checks: [
        {
          id: "check-private-id",
          key: "contact_path",
          label: "Contact paths",
          status: "FAIL",
          summary: "A direct contact path was not found.",
          evidence: {
            primitive: "value",
            count: 2,
            enabled: false,
            absent: null,
            nested: { private: "secret" },
            list: ["private"],
            long: "x".repeat(301),
          },
          unrelated: "Do not include this.",
        },
        {
          key: "unrelated_check",
          label: "Unrelated check",
          status: "PASS",
          summary: "Do not include this check.",
          evidence: { private: "secret" },
        },
      ],
      sender: {
        id: "profile-private-id",
        senderName: "Casey",
        companyName: "Northstar Studio",
        serviceOffered: "Website conversion optimization",
        valueProposition:
          "We help service businesses turn clearer websites into better sales conversations.",
        defaultCta: "Would a brief conversation next week be useful?",
        userId: "user-private-id",
      },
    });

    expect(result).toEqual({
      recipientFirstName: "Jordan",
      businessName: "Acme",
      hostname: "acme.example",
      recommendation: {
        title: "Improve contact paths",
        rationale: "Visitors have no clear route to start a conversation.",
        action: "Add a visible contact action to service pages.",
      },
      evidence: [
        {
          key: "contact_path",
          label: "Contact paths",
          status: "FAIL",
          summary: "A direct contact path was not found.",
          evidence: {
            primitive: "value",
            count: 2,
            enabled: false,
            absent: null,
            long: "x".repeat(300),
          },
        },
      ],
      sender: {
        senderName: "Casey",
        companyName: "Northstar Studio",
        serviceOffered: "Website conversion optimization",
        valueProposition:
          "We help service businesses turn clearer websites into better sales conversations.",
        defaultCta: "Would a brief conversation next week be useful?",
      },
    });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("caps selected evidence at twenty entries", () => {
    const result = buildOutreachInput({
      prospect: {
        contactName: "Jordan",
        name: "Acme",
        requestedUrl: "https://acme.example",
      },
      recommendation: {
        title: "Improve contact paths",
        rationale: "Visitors have no clear route to start a conversation.",
        action: "Add a visible contact action to service pages.",
        auditCheckKeys: Array.from(
          { length: 21 },
          (_, index) => `check-${index}`
        ),
      },
      checks: Array.from({ length: 21 }, (_, index) => ({
        key: `check-${index}`,
        label: `Check ${index}`,
        status: "FAIL",
        summary: "A relevant issue was found.",
        evidence: {},
      })),
      sender: {
        senderName: "Casey",
        companyName: "Northstar Studio",
        serviceOffered: "Website conversion optimization",
        valueProposition:
          "We help service businesses improve sales conversations.",
        defaultCta: "Would a brief conversation next week be useful?",
      },
    });

    expect(result.evidence).toHaveLength(20);
    expect(result.evidence.at(-1)?.key).toBe("check-19");
  });
});

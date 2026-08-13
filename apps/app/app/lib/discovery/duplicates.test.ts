import { describe, expect, it } from "vitest";
import {
  buildExistingIdentityIndex,
  findDuplicateProspectId,
} from "./duplicates";

const existing = [
  {
    id: "p1",
    websiteUrl: "https://www.aceplumbing.com",
    phone: "513-555-0100",
    businessName: "Ace Plumbing",
    location: "Cincinnati, OH",
    sourceExternalId: null,
  },
  {
    id: "p2",
    websiteUrl: null,
    phone: null,
    businessName: "Bob's HVAC",
    location: "123 Elm St",
    sourceExternalId: "ext-42",
  },
];

describe("findDuplicateProspectId", () => {
  const index = buildExistingIdentityIndex(existing);

  it("matches by domain first", () => {
    expect(
      findDuplicateProspectId(
        {
          websiteUrl: "https://aceplumbing.com/contact",
          phone: null,
          businessName: "Different Name",
          formattedAddress: null,
          providerCandidateId: null,
        },
        index
      )
    ).toBe("p1");
  });

  it("matches by sourceExternalId when domain does not match", () => {
    expect(
      findDuplicateProspectId(
        {
          websiteUrl: null,
          phone: null,
          businessName: "Different Name",
          formattedAddress: null,
          providerCandidateId: "ext-42",
        },
        index
      )
    ).toBe("p2");
  });

  it("matches by phone when domain and id do not match", () => {
    expect(
      findDuplicateProspectId(
        {
          websiteUrl: null,
          phone: "(513) 555-0100",
          businessName: "Different Name",
          formattedAddress: null,
          providerCandidateId: null,
        },
        index
      )
    ).toBe("p1");
  });

  it("matches by name+address when nothing else matches", () => {
    expect(
      findDuplicateProspectId(
        {
          websiteUrl: null,
          phone: null,
          businessName: "Bob's HVAC",
          formattedAddress: "123 Elm St",
          providerCandidateId: null,
        },
        index
      )
    ).toBe("p2");
  });

  it("returns null when nothing matches", () => {
    expect(
      findDuplicateProspectId(
        {
          websiteUrl: "https://totally-different.com",
          phone: "999",
          businessName: "New Co",
          formattedAddress: "999 Nowhere",
          providerCandidateId: null,
        },
        index
      )
    ).toBeNull();
  });
});

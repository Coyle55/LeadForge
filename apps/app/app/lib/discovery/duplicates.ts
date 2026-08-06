import {
  normalizeAddress,
  normalizeDomain,
  normalizeName,
  normalizePhone,
} from "./normalize";

interface ExistingProspectRecord {
  businessName: string;
  id: string;
  location: string | null;
  phone: string | null;
  sourceExternalId: string | null;
  websiteUrl: string | null;
}

interface ExistingIdentityIndex {
  byDomain: Map<string, string>;
  byNameAddress: Map<string, string>;
  byPhone: Map<string, string>;
  bySourceExternalId: Map<string, string>;
}

export const buildExistingIdentityIndex = (
  prospects: ExistingProspectRecord[]
): ExistingIdentityIndex => {
  const index: ExistingIdentityIndex = {
    byDomain: new Map(),
    bySourceExternalId: new Map(),
    byPhone: new Map(),
    byNameAddress: new Map(),
  };
  for (const prospect of prospects) {
    const domain = prospect.websiteUrl
      ? normalizeDomain(prospect.websiteUrl)
      : null;
    if (domain && !index.byDomain.has(domain)) {
      index.byDomain.set(domain, prospect.id);
    }
    if (
      prospect.sourceExternalId &&
      !index.bySourceExternalId.has(prospect.sourceExternalId)
    ) {
      index.bySourceExternalId.set(prospect.sourceExternalId, prospect.id);
    }
    const phone = prospect.phone ? normalizePhone(prospect.phone) : null;
    if (phone && !index.byPhone.has(phone)) {
      index.byPhone.set(phone, prospect.id);
    }
    const nameAddressKey = `${normalizeName(prospect.businessName)}|${normalizeAddress(prospect.location ?? "")}`;
    if (!index.byNameAddress.has(nameAddressKey)) {
      index.byNameAddress.set(nameAddressKey, prospect.id);
    }
  }
  return index;
};

export const findDuplicateProspectId = (
  candidate: {
    businessName: string;
    formattedAddress: string | null;
    phone: string | null;
    providerCandidateId: string | null;
    websiteUrl: string | null;
  },
  index: ExistingIdentityIndex
): string | null => {
  const domain = candidate.websiteUrl
    ? normalizeDomain(candidate.websiteUrl)
    : null;
  if (domain && index.byDomain.has(domain)) {
    return index.byDomain.get(domain) ?? null;
  }
  if (
    candidate.providerCandidateId &&
    index.bySourceExternalId.has(candidate.providerCandidateId)
  ) {
    return index.bySourceExternalId.get(candidate.providerCandidateId) ?? null;
  }
  const phone = candidate.phone ? normalizePhone(candidate.phone) : null;
  if (phone && index.byPhone.has(phone)) {
    return index.byPhone.get(phone) ?? null;
  }
  const nameAddressKey = `${normalizeName(candidate.businessName)}|${normalizeAddress(candidate.formattedAddress ?? "")}`;
  return index.byNameAddress.get(nameAddressKey) ?? null;
};

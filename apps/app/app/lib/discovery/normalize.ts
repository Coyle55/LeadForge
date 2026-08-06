export const normalizeDomain = (url: string): string | null => {
  try {
    const parsed = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(url) ? url : `https://${url}`
    );
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
};

export const normalizePhone = (phone: string): string | null => {
  const digits = phone.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
};

const collapseAndStrip = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

export const normalizeName = (name: string): string => collapseAndStrip(name);
export const normalizeAddress = (address: string): string => collapseAndStrip(address);

export const hashIdentity = (value: string): string => {
  // Simple, deterministic, dependency-free string hash (FNV-1a), sufficient
  // for a local identity key -- not a security boundary.
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
};

// Regex patterns hoisted for performance
const PROTOCOL_REGEX = /^[a-z][a-z\d+.-]*:\/\//i;
const WWW_PREFIX_REGEX = /^www\./;
const STRIP_PUNCTUATION_REGEX = /[^\p{L}\p{N}\s]/gu;
const COLLAPSE_WHITESPACE_REGEX = /\s+/g;
const NON_DIGITS_REGEX = /\D/g;

export const normalizeDomain = (url: string): string | null => {
  try {
    const parsed = new URL(PROTOCOL_REGEX.test(url) ? url : `https://${url}`);
    return parsed.hostname.toLowerCase().replace(WWW_PREFIX_REGEX, "");
  } catch {
    return null;
  }
};

export const normalizePhone = (phone: string): string | null => {
  const digits = phone.replace(NON_DIGITS_REGEX, "");
  return digits.length > 0 ? digits : null;
};

const collapseAndStrip = (value: string): string =>
  value
    .toLowerCase()
    .replace(STRIP_PUNCTUATION_REGEX, "")
    .replace(COLLAPSE_WHITESPACE_REGEX, " ")
    .trim();

export const normalizeName = (name: string): string => collapseAndStrip(name);
export const normalizeAddress = (address: string): string =>
  collapseAndStrip(address);

export const hashIdentity = (value: string): string => {
  // Simple, deterministic, dependency-free string hash, sufficient
  // for a local identity key -- not a security boundary.
  // Uses djb2 algorithm with modular arithmetic (no bitwise ops).
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33 + value.charCodeAt(i)) % 2 ** 32;
  }
  return Math.abs(hash).toString(16);
};

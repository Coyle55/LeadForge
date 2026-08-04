import { isIP } from "node:net";
import { AuditEngineError } from "./errors";
import type { ResolveHostname } from "./types";

const blockedNames = new Set(["localhost", "localhost.localdomain"]);

const parseIpv4 = (address: string) => {
  const parts = address.split(".").map(Number);
  return parts.length === 4 && parts.every((part) => part >= 0 && part <= 255)
    ? parts
    : null;
};

const isPublicIpv4 = (address: string) => {
  const parts = parseIpv4(address);
  if (!parts) return false;
  const [a, b] = parts;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51) ||
    (a === 203 && b === 0)
  );
};

const isPublicIp = (address: string) => {
  if (isIP(address) === 4) return isPublicIpv4(address);
  if (isIP(address) !== 6) return false;
  const value = address.toLowerCase();
  return !(
    value === "::" ||
    value === "::1" ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    value.startsWith("fe8") ||
    value.startsWith("fe9") ||
    value.startsWith("fea") ||
    value.startsWith("feb") ||
    value.startsWith("2001:db8") ||
    value.startsWith("::ffff:127.") ||
    value.startsWith("::ffff:10.") ||
    value.startsWith("::ffff:192.168.")
  );
};

export const validatePublicTarget = async (
  input: string | URL,
  dependencies: { resolveHostname: ResolveHostname }
) => {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new AuditEngineError("INVALID_TARGET");
  }
  if (!(url.protocol === "http:" || url.protocol === "https:")) {
    throw new AuditEngineError("INVALID_TARGET");
  }
  if (url.username || url.password) {
    throw new AuditEngineError("BLOCKED_TARGET");
  }
  url.hash = "";
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (blockedNames.has(hostname) || hostname.endsWith(".localhost")) {
    throw new AuditEngineError("BLOCKED_TARGET");
  }
  const addresses = isIP(hostname)
    ? [hostname]
    : await dependencies.resolveHostname(hostname).catch(() => []);
  if (addresses.length === 0) {
    throw new AuditEngineError("UNREACHABLE");
  }
  if (addresses.some((address) => !isPublicIp(address))) {
    throw new AuditEngineError("BLOCKED_TARGET");
  }
  return url;
};

export const resolveRedirectTarget = async (
  location: string,
  currentUrl: URL,
  dependencies: { resolveHostname: ResolveHostname }
) => await validatePublicTarget(new URL(location, currentUrl), dependencies);

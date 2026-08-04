export type AuditFailureCode =
  | "INVALID_TARGET"
  | "BLOCKED_TARGET"
  | "ROBOTS_BLOCKED"
  | "TIMEOUT"
  | "UNREACHABLE"
  | "INVALID_RESPONSE"
  | "RESPONSE_TOO_LARGE"
  | "INTERNAL_ERROR";

const messages: Record<AuditFailureCode, string> = {
  INVALID_TARGET: "The website address is not valid.",
  BLOCKED_TARGET: "The website target is not publicly reachable.",
  ROBOTS_BLOCKED: "The website does not allow this audit crawler.",
  TIMEOUT: "The website audit timed out.",
  UNREACHABLE: "The website could not be reached.",
  INVALID_RESPONSE: "The website returned an unsupported response.",
  RESPONSE_TOO_LARGE: "The website response exceeded the audit limit.",
  INTERNAL_ERROR: "The website audit could not be completed.",
};

export class AuditEngineError extends Error {
  readonly code: AuditFailureCode;

  constructor(code: AuditFailureCode) {
    super(messages[code]);
    this.name = "AuditEngineError";
    this.code = code;
  }
}

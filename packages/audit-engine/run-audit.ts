import { resolve } from "node:dns/promises";
import { evaluateChecks } from "./checks";
import { crawlWebsite } from "./crawler";
import type { AuditDependencies } from "./types";

export const runWebsiteAudit = async (
  url: string,
  dependencies: Partial<AuditDependencies> = {}
) => {
  const now = dependencies.now ?? Date.now;
  const started = now();
  const crawl = await crawlWebsite(url, {
    fetch: dependencies.fetch,
    now,
    resolveHostname:
      dependencies.resolveHostname ??
      (async (hostname) => (await resolve(hostname)).map(String)),
  });
  return {
    requestedUrl: crawl.requestedUrl,
    finalUrl: crawl.finalUrl,
    pagesAttempted: crawl.pagesAttempted,
    pagesAudited: crawl.pagesAudited,
    durationMs: now() - started,
    checks: evaluateChecks(crawl),
  };
};

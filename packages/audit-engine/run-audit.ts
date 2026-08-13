import { resolve } from "node:dns/promises";
import { evaluateChecks } from "./checks";
import { crawlWebsite } from "./crawler";
import { AuditEngineError } from "./errors";
import type { ScreenshotResult } from "./screenshot";
import { noopScreenshotProvider } from "./screenshot";
import type { AuditDependencies } from "./types";

export const runWebsiteAudit = async (
  url: string,
  dependencies: Partial<AuditDependencies> = {}
) => {
  const now = dependencies.now ?? Date.now;
  const started = now();
  const screenshotProvider =
    dependencies.screenshotProvider ?? noopScreenshotProvider;
  const crawlPromise = crawlWebsite(url, {
    fetch: dependencies.fetch,
    now,
    resolveHostname:
      dependencies.resolveHostname ??
      (async (hostname) => (await resolve(hostname)).map(String)),
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new AuditEngineError("TIMEOUT")), 20_000);
  });
  const crawl = await Promise.race([crawlPromise, deadline]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
  // The crawl succeeded at this point (a failed crawl throws above), so it is
  // safe to attempt screenshot capture. A throwing/rejecting provider must
  // never turn a successful audit into a failed one.
  let screenshot: ScreenshotResult;
  try {
    screenshot = await screenshotProvider.capture(crawl.finalUrl);
  } catch {
    screenshot = { status: "unavailable", reason: "capture_failed" };
  }
  return {
    requestedUrl: crawl.requestedUrl,
    finalUrl: crawl.finalUrl,
    pagesAttempted: crawl.pagesAttempted,
    pagesAudited: crawl.pagesAudited,
    durationMs: now() - started,
    checks: evaluateChecks(crawl),
    screenshot,
  };
};

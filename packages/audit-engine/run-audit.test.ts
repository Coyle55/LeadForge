import { describe, expect, it } from "vitest";
import { runWebsiteAudit } from "./run-audit";

const html = (body: string) =>
  new Response(
    `<!doctype html><html lang="en"><head><title>Page</title><meta name="viewport" content="width=device-width"></head><body>${body}</body></html>`,
    { headers: { "content-type": "text/html" } }
  );

const okFetch = (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.endsWith("/robots.txt")) {
    return Promise.resolve(new Response("User-agent: *\nAllow: /"));
  }
  return Promise.resolve(html("<h1>Home</h1>"));
};

describe("runWebsiteAudit screenshot wiring", () => {
  it("resolves successfully with an unavailable screenshot when the provider throws", async () => {
    const result = await runWebsiteAudit("https://example.com", {
      resolveHostname: async () => ["93.184.216.34"],
      fetch: okFetch,
      screenshotProvider: {
        capture: () => {
          throw new Error("boom");
        },
      },
    });
    expect(result.screenshot).toEqual({
      status: "unavailable",
      reason: "capture_failed",
    });
    expect(result.finalUrl).toBe("https://example.com/");
    expect(result.checks.length).toBeGreaterThan(0);
  });

  it("resolves successfully with an unavailable screenshot when the provider's promise rejects", async () => {
    const result = await runWebsiteAudit("https://example.com", {
      resolveHostname: async () => ["93.184.216.34"],
      fetch: okFetch,
      screenshotProvider: {
        capture: () => Promise.reject(new Error("boom")),
      },
    });
    expect(result.screenshot).toEqual({
      status: "unavailable",
      reason: "capture_failed",
    });
  });

  it("uses the default noop screenshot provider when none is supplied", async () => {
    const result = await runWebsiteAudit("https://example.com", {
      resolveHostname: async () => ["93.184.216.34"],
      fetch: okFetch,
    });
    expect(result.screenshot).toEqual({
      status: "unavailable",
      reason: "not_configured",
    });
  });

  it("passes the successful crawl's finalUrl to the screenshot provider", async () => {
    let capturedUrl: string | undefined;
    const result = await runWebsiteAudit("https://example.com", {
      resolveHostname: async () => ["93.184.216.34"],
      fetch: okFetch,
      screenshotProvider: {
        capture: (url: string) => {
          capturedUrl = url;
          return Promise.resolve({
            status: "captured" as const,
            url: "https://cdn.example.com/shot.png",
          });
        },
      },
    });
    expect(capturedUrl).toBe("https://example.com/");
    expect(result.screenshot).toEqual({
      status: "captured",
      url: "https://cdn.example.com/shot.png",
    });
  });

  it("never attempts screenshot capture when the crawl itself fails", async () => {
    let called = false;
    await expect(
      runWebsiteAudit("https://example.com", {
        resolveHostname: async () => ["93.184.216.34"],
        fetch: () =>
          Promise.resolve(
            new Response("User-agent: LeadForgeAudit\nDisallow: /")
          ),
        screenshotProvider: {
          capture: () => {
            called = true;
            return Promise.resolve({
              status: "unavailable" as const,
              reason: "not_configured",
            });
          },
        },
      })
    ).rejects.toMatchObject({ code: "ROBOTS_BLOCKED" });
    expect(called).toBe(false);
  });
});

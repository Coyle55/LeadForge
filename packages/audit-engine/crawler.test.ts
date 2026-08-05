import { describe, expect, it } from "vitest";
import { crawlWebsite } from "./crawler";

const html = (body: string) =>
  new Response(
    `<!doctype html><html lang="en"><head><title>Page</title><meta name="viewport" content="width=device-width"></head><body>${body}</body></html>`,
    {
      headers: { "content-type": "text/html" },
    }
  );

describe("crawlWebsite", () => {
  it("crawls only five useful same-origin pages", async () => {
    const requested: string[] = [];
    const result = await crawlWebsite("https://example.com", {
      resolveHostname: async () => ["93.184.216.34"],
      fetch: (input) => {
        const url = String(input);
        requested.push(url);
        if (url.endsWith("/robots.txt")) {
          return Promise.resolve(new Response("User-agent: *\nAllow: /"));
        }
        if (url === "https://example.com/") {
          return Promise.resolve(
            html(
              '<a href="/blog">Blog</a><a href="/contact">Contact</a><a href="/about">About</a><a href="/services">Services</a><a href="/pricing">Pricing</a><a href="https://other.test/x">Other</a>'
            )
          );
        }
        return Promise.resolve(html(`<h1>${url}</h1>`));
      },
    });
    expect(result.pages.map((page) => page.url)).toEqual([
      "https://example.com/",
      "https://example.com/contact",
      "https://example.com/about",
      "https://example.com/services",
      "https://example.com/pricing",
    ]);
    expect(result.pagesAudited).toBe(5);
    expect(requested).not.toContain("https://other.test/x");
  });

  it("samples image URLs and counts broken ones, capped at 20", async () => {
    const requested: string[] = [];
    const result = await crawlWebsite("https://example.com", {
      resolveHostname: async () => ["93.184.216.34"],
      fetch: (input, init) => {
        const url = String(input);
        requested.push(url);
        if (url.endsWith("/robots.txt")) {
          return Promise.resolve(new Response("User-agent: *\nAllow: /"));
        }
        if (url === "https://example.com/") {
          return Promise.resolve(
            html(
              '<img src="/good.png"><img src="/broken.png"><img src="/errors.png">'
            )
          );
        }
        if (init?.method === "HEAD" && url.endsWith("/broken.png")) {
          return Promise.resolve(new Response(null, { status: 404 }));
        }
        if (init?.method === "HEAD" && url.endsWith("/errors.png")) {
          return Promise.reject(new Error("network down"));
        }
        if (init?.method === "HEAD") {
          return Promise.resolve(new Response(null, { status: 200 }));
        }
        return Promise.resolve(html("<h1>page</h1>"));
      },
    });
    expect(result.pages[0].imageUrls).toEqual([
      "https://example.com/good.png",
      "https://example.com/broken.png",
      "https://example.com/errors.png",
    ]);
    expect(result.brokenImages).toBe(2);
  });

  it("caps the sampled image URLs at 20 total", async () => {
    const manyImages = Array.from(
      { length: 25 },
      (_, index) => `<img src="/image-${index}.png">`
    ).join("");
    let headCount = 0;
    const result = await crawlWebsite("https://example.com", {
      resolveHostname: async () => ["93.184.216.34"],
      fetch: (input, init) => {
        const url = String(input);
        if (url.endsWith("/robots.txt")) {
          return Promise.resolve(new Response("User-agent: *\nAllow: /"));
        }
        if (url === "https://example.com/") {
          return Promise.resolve(html(manyImages));
        }
        if (init?.method === "HEAD") {
          headCount += 1;
          return Promise.resolve(new Response(null, { status: 200 }));
        }
        return Promise.resolve(html("<h1>page</h1>"));
      },
    });
    expect(result.pages[0].imageUrls).toHaveLength(25);
    expect(headCount).toBeLessThanOrEqual(20);
    expect(result.brokenImages).toBe(0);
  });

  it("honors a robots exclusion for the homepage", async () => {
    await expect(
      crawlWebsite("https://example.com", {
        resolveHostname: async () => ["93.184.216.34"],
        fetch: async (input) =>
          String(input).endsWith("robots.txt")
            ? new Response("User-agent: LeadForgeAudit\nDisallow: /")
            : html("<h1>Hidden</h1>"),
      })
    ).rejects.toMatchObject({ code: "ROBOTS_BLOCKED" });
  });
});
